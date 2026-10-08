import path from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { PDFParse, type OutlineNode } from "pdf-parse";
import { type BookCover, createTextCover, detectRasterCover } from "@/lib/book-cover";

export type BookFormat = "EPUB" | "PDF" | "TXT";

export interface ParsedSection {
  title: string;
  chapterTitle?: string;
  kind: "CHAPTER" | "FRONT_MATTER" | "PAGE";
  locator?: string;
  paragraphs: string[];
}

export interface ParsedNavigationEntry {
  title: string;
  kind: "CHAPTER" | "FRONT_MATTER";
  targetOrderIndex: number;
  depth: number;
  sourcePage?: number;
}

export interface ParseCleanupSummary {
  technicalSectionsRemoved: number;
  frontMatterSectionCount: number;
  chapterCount: number;
  outlineEntryCount: number;
  filteredTocPageCount: number;
  suspectedScannedPageCount: number;
  suspectedLayoutIssueCount: number;
}

export interface ParsedBook {
  title: string;
  author?: string;
  format: BookFormat;
  sections: ParsedSection[];
  cover: BookCover;
  sourceSectionCount: number;
  parserVersion: number;
  cleanupSummary: ParseCleanupSummary;
  navigationEntries: ParsedNavigationEntry[];
}

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

export const normalizeText = (value: string) =>
  decodeEntities(value)
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const LEARNING_PAGE_TARGET_WORDS = 450;
export const LEARNING_PAGE_MAX_WORDS = 650;
export const LEARNING_PAGE_MIN_WORDS = 300;

interface PaginationOptions {
  targetWords?: number;
  maxWords?: number;
  minWords?: number;
}

const splitByWordBudget = (text: string, maxWords: number) => {
  const tokens = normalizeText(text).split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const token of tokens) {
    const tokenWords = Math.max(1, countWords(token));
    if (current.length && currentWords + tokenWords > maxWords) {
      chunks.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
    current.push(token);
    currentWords += tokenWords;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
};

const splitLongParagraph = (paragraph: string, targetWords: number, maxWords: number) => {
  const normalized = normalizeText(paragraph);
  if (countWords(normalized) <= targetWords) return [normalized];
  const sentences = (normalized.match(/[^.!?]+(?:[.!?]+(?:["'’”\)\]]+)?|$)/g) || [normalized])
    .map(normalizeText)
    .filter(Boolean);
  const pieces: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length) pieces.push(current.join(" "));
    current = [];
    currentWords = 0;
  };

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (sentenceWords > maxWords) {
      flush();
      pieces.push(...splitByWordBudget(sentence, targetWords));
      continue;
    }
    if (current.length && currentWords + sentenceWords > targetWords) flush();
    current.push(sentence);
    currentWords += sentenceWords;
  }
  flush();
  return pieces.filter(Boolean);
};

export function paginateSectionsForLearning(
  sections: ParsedSection[],
  options: PaginationOptions = {},
): ParsedSection[] {
  const targetWords = Math.max(100, options.targetWords || LEARNING_PAGE_TARGET_WORDS);
  const maxWords = Math.max(targetWords, options.maxWords || LEARNING_PAGE_MAX_WORDS);
  const minWords = Math.min(targetWords, Math.max(50, options.minWords || LEARNING_PAGE_MIN_WORDS));

  const readable = sections.filter((section) => {
    const text = normalizeText(section.paragraphs.join(" "));
    const title = normalizeText(section.title).toLowerCase();
    if (/^(cover|title page|table of contents|contents|copyright|publication information)$/i.test(title)) return false;
    if (/(table of contents|copyright|all rights reserved|publication information|isbn\b)/i.test(title)) return false;
    if ((text.match(/\.{2,}\s*\d+/g) || []).length >= 3) return false;
    return Boolean(text);
  });
  const groups: ParsedSection[][] = [];
  for (const section of readable) {
    const previous = groups[groups.length - 1];
    const first = previous?.[0];
    const canMerge = first
      && first.kind !== "FRONT_MATTER"
      && first.kind === section.kind
      && first.chapterTitle === section.chapterTitle;
    if (previous && canMerge) previous.push(section);
    else groups.push([section]);
  }

  return groups.flatMap((group) => {
    const first = group[0];
    const paragraphPieces = group.flatMap((section) => section.paragraphs)
      .map(normalizeText)
      .filter(Boolean)
      .flatMap((paragraph) => splitLongParagraph(paragraph, targetWords, maxWords));
    if (!paragraphPieces.length) return [];

    const pages: string[][] = [];
    let current: string[] = [];
    let currentWords = 0;
    const flush = () => {
      if (current.length) pages.push(current);
      current = [];
      currentWords = 0;
    };

    for (const paragraph of paragraphPieces) {
      const paragraphWords = countWords(paragraph);
      const combinedWords = currentWords + paragraphWords;
      if (current.length && (combinedWords > maxWords || (currentWords >= minWords && combinedWords > targetWords))) flush();
      current.push(paragraph);
      currentWords += paragraphWords;
    }
    flush();

    if (pages.length > 1) {
      const last = pages[pages.length - 1];
      const previous = pages[pages.length - 2];
      const lastWords = countWords(last.join(" "));
      const previousWords = countWords(previous.join(" "));
      if (lastWords < minWords && previousWords + lastWords <= maxWords) {
        previous.push(...last);
        pages.pop();
      }
    }

    return pages.map((paragraphs, index) => ({
      ...first,
      title: first.chapterTitle || first.title,
      locator: `${group.map((section) => section.locator || section.title).join("|")}|studyPart=${index + 1}/${pages.length}`,
      paragraphs,
    }));
  });
}

type ParsedBookInput = Omit<ParsedBook, "sourceSectionCount" | "parserVersion" | "cleanupSummary" | "navigationEntries"> & {
  parserVersion?: number;
  cleanupSummary?: Partial<ParseCleanupSummary>;
  navigationEntries?: ParsedNavigationEntry[];
};

const finalizeParsedBook = (book: ParsedBookInput): ParsedBook => {
  const sections = paginateSectionsForLearning(book.sections);
  const chapterCount = new Set(
    sections
      .filter((section) => section.kind !== "FRONT_MATTER" && section.chapterTitle)
      .map((section) => section.chapterTitle),
  ).size;
  return {
    ...book,
    sourceSectionCount: book.sections.length,
    parserVersion: book.parserVersion || 6,
    navigationEntries: book.navigationEntries || [],
    cleanupSummary: {
      technicalSectionsRemoved: book.cleanupSummary?.technicalSectionsRemoved || 0,
      frontMatterSectionCount: book.cleanupSummary?.frontMatterSectionCount
        ?? sections.filter((section) => section.kind === "FRONT_MATTER").length,
      chapterCount: book.cleanupSummary?.chapterCount ?? chapterCount,
      outlineEntryCount: book.cleanupSummary?.outlineEntryCount || 0,
      filteredTocPageCount: book.cleanupSummary?.filteredTocPageCount || 0,
      suspectedScannedPageCount: book.cleanupSummary?.suspectedScannedPageCount || 0,
      suspectedLayoutIssueCount: book.cleanupSummary?.suspectedLayoutIssueCount || 0,
    },
    sections,
  };
};

const htmlToParagraphs = (html: string) => {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(withoutNoise)
    .split(/\n\s*\n/)
    .map(normalizeText)
    .filter((paragraph) => paragraph.length > 0);
};

const normalizedHeading = (value: string) => normalizeText(value)
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, " ")
  .trim();

const isTechnicalPartLabel = (value: string) => /^part\s*0*\d+$/i.test(normalizeText(value));

const isStandaloneChapterNumber = (value: string) => /^(?:\d+|[ivxlcdm]+)$/i.test(normalizeText(value));

const isFrontMatterTitle = (value: string, bookTitle: string) => {
  const title = normalizedHeading(value);
  const normalizedBookTitle = normalizedHeading(bookTitle);
  return title === normalizedBookTitle
    || /^(?:about (?:the|this) book|about the author|dedication|book description|作品简介|关于本书|关于作者|献词)$/.test(title);
};

const isDiscardablePublicationTitle = (value: string) => /^(?:cover|title page|copyright|publication information|imprint|also by|praise for)$/i.test(normalizeText(value));

function cleanEpubParagraphs(paragraphs: string[], chapterTitle: string, bookTitle: string) {
  const cleaned = paragraphs.map(normalizeText).filter(Boolean);
  const chapterHeading = normalizedHeading(chapterTitle);
  const bookHeading = normalizedHeading(bookTitle);

  while (cleaned.length) {
    const first = normalizedHeading(cleaned[0]);
    const duplicateHeading = first && (first === chapterHeading || first === bookHeading);
    const standaloneChapterNumber = /^(?:chapter|book|part)\b/i.test(chapterTitle)
      && isStandaloneChapterNumber(cleaned[0]);
    if (isTechnicalPartLabel(cleaned[0]) || duplicateHeading || standaloneChapterNumber) {
      cleaned.shift();
      continue;
    }
    break;
  }
  return cleaned;
}

const textToSections = (text: string, fallbackTitle: string): ParsedSection[] => {
  const lines = normalizeText(text).split("\n");
  const heading = /^(chapter|part|book)\s+([\divxlcdm]+|\w+)(?:\s*[:.-]\s*.*)?$/i;
  const sections: ParsedSection[] = [];
  let title = fallbackTitle;
  let buffer: string[] = [];

  const flush = () => {
    const paragraphs = normalizeText(buffer.join("\n"))
      .split(/\n\s*\n/)
      .map(normalizeText)
      .filter(Boolean);
    if (paragraphs.length) sections.push({ title, chapterTitle: title === fallbackTitle ? undefined : title, kind: "CHAPTER", paragraphs });
    buffer = [];
  };

  for (const line of lines) {
    if (heading.test(line.trim()) && buffer.join(" ").trim().length > 200) {
      flush();
      title = line.trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
};

const elementText = (document: Document, localName: string) => {
  const nodes = Array.from(document.getElementsByTagName("*"));
  return nodes.find((node) => node.localName === localName)?.textContent?.trim();
};

const safeDecodePath = (value: string) => {
  try {
    return decodeURIComponent(value.split("#")[0]);
  } catch {
    return value.split("#")[0];
  }
};

async function loadEpubPackage(zip: JSZip) {
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("EPUB 缺少 META-INF/container.xml");
  const containerDoc = new DOMParser().parseFromString(containerXml, "text/xml");
  const rootfile = Array.from(containerDoc.getElementsByTagName("*")).find((node) => node.localName === "rootfile");
  const packagePath = rootfile?.getAttribute("full-path");
  if (!packagePath) throw new Error("无法找到 EPUB package 文件");
  const packageXml = await zip.file(packagePath)?.async("string");
  if (!packageXml) throw new Error("无法读取 EPUB package 文件");
  const packageDoc = new DOMParser().parseFromString(packageXml, "text/xml");
  const nodes = Array.from(packageDoc.getElementsByTagName("*"));
  return { packagePath, packageDoc, nodes };
}

interface EpubManifestItem {
  href: string;
  mediaType: string;
  properties?: string;
}

interface EpubNavigationCandidate {
  title: string;
  entryPath: string;
  depth: number;
  kind: "CHAPTER" | "FRONT_MATTER";
}

function resolveEpubEntry(baseEntryPath: string, href: string) {
  const fileHref = safeDecodePath(href).split(/[?#]/, 1)[0];
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseEntryPath), fileHref));
}

function ancestorDepth(node: Node, root: Node, ancestorName: string) {
  let depth = 0;
  let current = node.parentNode;
  while (current && current !== root) {
    if ((current as Element).localName === ancestorName) depth += 1;
    current = current.parentNode;
  }
  return Math.max(0, depth - (ancestorName === "li" ? 1 : 0));
}

async function readEpubNavigation(
  zip: JSZip,
  packagePath: string,
  packageDoc: Document,
  nodes: Element[],
  manifest: Map<string, EpubManifestItem>,
) {
  const chapterByEntry = new Map<string, string>();
  const navigationCandidates: EpubNavigationCandidate[] = [];
  const packageDir = path.posix.dirname(packagePath.replace(/\\/g, "/"));
  const navItem = Array.from(manifest.values()).find((item) => item.properties?.split(/\s+/).includes("nav"));

  if (navItem) {
    const navEntryPath = path.posix.normalize(path.posix.join(packageDir, safeDecodePath(navItem.href)));
    const navXml = await zip.file(navEntryPath)?.async("string");
    if (navXml) {
      const navDoc = new DOMParser().parseFromString(navXml, "application/xhtml+xml");
      const navElements = Array.from(navDoc.getElementsByTagName("*")).filter((node) => node.localName === "nav");
      const tocNav = navElements.find((node) => `${node.getAttribute("epub:type") || ""} ${node.getAttribute("role") || ""}`.toLowerCase().includes("toc")) || navElements[0];
      if (tocNav) {
        for (const anchor of Array.from(tocNav.getElementsByTagName("*")).filter((node) => node.localName === "a")) {
          const href = anchor.getAttribute("href");
          const title = normalizeText(anchor.textContent || "");
          if (!href || !title) continue;
          const entryPath = resolveEpubEntry(navEntryPath, href);
          if (!chapterByEntry.has(entryPath)) chapterByEntry.set(entryPath, title);
          navigationCandidates.push({
            title,
            entryPath,
            depth: ancestorDepth(anchor, tocNav, "li"),
            kind: isFrontMatterTitle(title, "") ? "FRONT_MATTER" : "CHAPTER",
          });
        }
      }
    }
  }

  const hasNavCandidates = navigationCandidates.length > 0;

  const spine = nodes.find((node) => node.localName === "spine");
  const ncxId = spine?.getAttribute("toc");
  const ncxItem = ncxId ? manifest.get(ncxId) : Array.from(manifest.values()).find((item) => /ncx/i.test(item.mediaType));
  if (ncxItem) {
    const ncxEntryPath = path.posix.normalize(path.posix.join(packageDir, safeDecodePath(ncxItem.href)));
    const ncxXml = await zip.file(ncxEntryPath)?.async("string");
    if (ncxXml) {
      const ncxDoc = new DOMParser().parseFromString(ncxXml, "text/xml");
      for (const navPoint of Array.from(ncxDoc.getElementsByTagName("*")).filter((node) => node.localName === "navPoint")) {
        const descendants = Array.from(navPoint.getElementsByTagName("*"));
        const href = descendants.find((node) => node.localName === "content")?.getAttribute("src");
        const title = normalizeText(descendants.find((node) => node.localName === "text")?.textContent || "");
        if (!href || !title) continue;
        const entryPath = resolveEpubEntry(ncxEntryPath, href);
        if (!chapterByEntry.has(entryPath)) chapterByEntry.set(entryPath, title);
        if (!hasNavCandidates) {
          navigationCandidates.push({
            title,
            entryPath,
            depth: ancestorDepth(navPoint, ncxDoc, "navPoint"),
            kind: isFrontMatterTitle(title, "") ? "FRONT_MATTER" : "CHAPTER",
          });
        }
      }
    }
  }

  return { chapterByEntry, navigationCandidates };
}

async function readEpubCover(
  zip: JSZip,
  packagePath: string,
  nodes: Array<Element>,
): Promise<BookCover | null> {
  const items = nodes.filter((node) => node.localName === "item");
  let coverItem = items.find((node) => (node.getAttribute("properties") || "").split(/\s+/).includes("cover-image"));
  if (!coverItem) {
    const coverMeta = nodes.find((node) => node.localName === "meta" && node.getAttribute("name")?.toLowerCase() === "cover");
    const coverId = coverMeta?.getAttribute("content");
    if (coverId) coverItem = items.find((node) => node.getAttribute("id") === coverId);
  }
  const href = coverItem?.getAttribute("href");
  const mediaType = coverItem?.getAttribute("media-type") || "";
  if (!href || !/^image\/(png|jpe?g|webp)$/i.test(mediaType)) return null;
  const packageDir = path.posix.dirname(packagePath.replace(/\\/g, "/"));
  const entryPath = path.posix.normalize(path.posix.join(packageDir, safeDecodePath(href)));
  const data = await zip.file(entryPath)?.async("nodebuffer");
  return data ? detectRasterCover(data) : null;
}

async function parseEpub(buffer: Buffer, fileName: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const { packagePath, packageDoc, nodes } = await loadEpubPackage(zip);
  const title = elementText(packageDoc as unknown as Document, "title") || path.parse(fileName).name;
  const author = elementText(packageDoc as unknown as Document, "creator") || undefined;
  const manifest = new Map<string, EpubManifestItem>();

  for (const node of nodes.filter((item) => item.localName === "item")) {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    const mediaType = node.getAttribute("media-type") || "";
    if (id && href) manifest.set(id, { href, mediaType, properties: node.getAttribute("properties") || undefined });
  }

  const packageDir = path.posix.dirname(packagePath.replace(/\\/g, "/"));
  const { chapterByEntry, navigationCandidates } = await readEpubNavigation(zip, packagePath, packageDoc as unknown as Document, nodes as unknown as Element[], manifest);
  const spineIds = nodes
    .filter((item) => item.localName === "itemref")
    .map((item) => item.getAttribute("idref"))
    .filter((value): value is string => Boolean(value));

  const sections: ParsedSection[] = [];
  let technicalSectionsRemoved = 0;
  let frontMatterSectionCount = 0;
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item || !/html|xhtml/i.test(item.mediaType)) continue;
    if (item.properties?.split(/\s+/).includes("nav")) continue;
    const entryPath = path.posix.normalize(path.posix.join(packageDir, safeDecodePath(item.href)));
    const html = await zip.file(entryPath)?.async("string");
    if (!html) continue;
    if (/epub:type\s*=\s*["'][^"']*toc/i.test(html)) continue;
    const extractedParagraphs = htmlToParagraphs(html);
    if (!extractedParagraphs.length) continue;
    const titleMatch = html.match(/<(h1|h2|title)[^>]*>([\s\S]*?)<\/\1>/i);
    const chapterTitle = chapterByEntry.get(entryPath) || (titleMatch
      ? normalizeText(titleMatch[2].replace(/<[^>]+>/g, " "))
      : "");
    const rawTitle = chapterTitle || `Chapter ${sections.length + 1}`;
    const reliableTitle = chapterByEntry.has(entryPath) || /^(part|chapter|book)\s+[\w\d]+/i.test(rawTitle) || (countWords(rawTitle) >= 2 && !/^part\d+$/i.test(rawTitle));
    const paragraphs = cleanEpubParagraphs(extractedParagraphs, rawTitle, title);
    const technicalTitle = isTechnicalPartLabel(rawTitle);
    const onlyDuplicateBookTitle = paragraphs.length === 1 && normalizedHeading(paragraphs[0]) === normalizedHeading(title);
    if (!paragraphs.length || (technicalTitle && onlyDuplicateBookTitle) || isDiscardablePublicationTitle(rawTitle)) {
      technicalSectionsRemoved += 1;
      continue;
    }

    const frontMatter = isFrontMatterTitle(rawTitle, title);
    if (frontMatter) frontMatterSectionCount += 1;
    sections.push({
      title: rawTitle,
      chapterTitle: frontMatter ? undefined : reliableTitle ? rawTitle : undefined,
      kind: frontMatter ? "FRONT_MATTER" : "CHAPTER",
      locator: entryPath,
      paragraphs,
    });
  }

  if (!sections.length) throw new Error("EPUB 中没有可阅读的文本章节");
  const cover = (await readEpubCover(zip, packagePath, nodes as unknown as Array<Element>)) || createTextCover(title, author);
  const parsed = finalizeParsedBook({
    title,
    author,
    format: "EPUB",
    sections,
    cover,
    parserVersion: 7,
    cleanupSummary: { technicalSectionsRemoved, frontMatterSectionCount },
  });
  return {
    ...parsed,
    navigationEntries: buildEpubNavigationEntries(parsed.sections, navigationCandidates),
  };
}

async function renderPdfCover(parser: PDFParse): Promise<BookCover | null> {
  const screenshot = await parser
    .getScreenshot({ partial: [1], desiredWidth: 600, imageDataUrl: false, imageBuffer: true })
    .catch(() => null);
  const page = screenshot?.pages[0];
  return page?.data ? detectRasterCover(Buffer.from(page.data)) : null;
}

interface PdfDocumentAccess {
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(reference: unknown): Promise<number>;
}

interface PdfOutlineEntry {
  title: string;
  displayTitle: string;
  page: number;
  depth: number;
}

interface PdfNavigationCandidate {
  title: string;
  kind: "CHAPTER" | "FRONT_MATTER";
  sourcePage: number;
  depth: number;
}

function cleanPdfOutlineTitle(value: string) {
  return normalizeText(value)
    .replace(/\s*(?:\.{3,}|…{2,}).*$/, "")
    .replace(/^Calculationg Pot Odds$/i, "Calculating Pot Odds")
    .trim();
}

async function readPdfOutlineEntries(parser: PDFParse, outline?: OutlineNode[] | null) {
  const entries: PdfOutlineEntry[] = [];
  const document = (parser as unknown as { doc?: PdfDocumentAccess }).doc;
  if (!document || !outline?.length) return entries;

  const visit = async (items: OutlineNode[], depth: number, parents: string[]): Promise<void> => {
    for (const item of items) {
      const title = cleanPdfOutlineTitle(item.title || "");
      const titlePath = title ? [...parents, title] : parents;
      if (title && item.dest) {
        try {
          const destination = typeof item.dest === "string" ? await document.getDestination(item.dest) : item.dest as unknown[];
          if (destination?.length) {
            const page = typeof destination[0] === "number"
              ? destination[0] + 1
              : (await document.getPageIndex(destination[0])) + 1;
            if (page > 0) entries.push({ title, displayTitle: titlePath.join(" · "), page, depth });
          }
        } catch {
          // Broken destinations are common; continue resolving the remaining outline.
        }
      }
      if (Array.isArray(item.items) && item.items.length) await visit(item.items as OutlineNode[], depth + 1, titlePath);
    }
  };
  await visit(outline, 0, []);
  return entries.sort((left, right) => left.page - right.page || left.depth - right.depth);
}

const pdfLines = (text: string) => text.split(/\r?\n/).map(normalizeText).filter(Boolean);

function isPdfDiscardedTitle(value?: string) {
  return /^(?:cover|title page|table of contents|contents|copyright|publication information|imprint)$/i.test(normalizeText(value || ""));
}

function isPdfFrontMatterTitle(value?: string) {
  return /^(?:about\b.+|acknowledgements?|dedication|book description|a cautionary note\b.*|notes? (?:to|about)\b.*|publication note|publisher'?s note|作品简介|关于本书|关于作者|献词)$/i.test(normalizeText(value || ""));
}

function isPdfMainMatterTitle(value?: string) {
  return /^(?:introduction|preface|foreword|prologue|part\s+[\divxlcdm\w]+\b|chapter\s+[\divxlcdm\w]+\b|book\s+[\divxlcdm\w]+\b)/i.test(normalizeText(value || ""));
}

function isExplicitPdfParentTitle(value: string) {
  return /^(?:part|book|volume|unit)\s+(?:[\divxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b|^section\s+(?:[\divxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(normalizeText(value));
}

function isNumberedPdfChapterTitle(value: string) {
  return /^chapter\s+(?:[\divxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b/i.test(normalizeText(value));
}

function conservativePdfHierarchy(entries: PdfOutlineEntry[]) {
  if (!entries.length) return entries;
  if (entries.some((entry) => entry.depth > 0)) {
    const baseDepth = Math.min(...entries.map((entry) => entry.depth));
    let previousDepth = 0;
    return entries.map((entry, index) => {
      const requested = Math.max(0, entry.depth - baseDepth);
      const depth = index === 0 ? 0 : Math.min(requested, previousDepth + 1);
      previousDepth = depth;
      return { ...entry, depth };
    });
  }

  const hasExplicitParents = entries.some((entry) => isExplicitPdfParentTitle(entry.title));
  if (hasExplicitParents) {
    let insideParent = false;
    return entries.map((entry) => {
      if (isExplicitPdfParentTitle(entry.title)) {
        insideParent = true;
        return { ...entry, depth: 0 };
      }
      return { ...entry, depth: insideParent ? 1 : 0 };
    });
  }

  const chapterIndexes = entries.flatMap((entry, index) => isNumberedPdfChapterTitle(entry.title) ? [index] : []);
  const chaptersHaveChildren = chapterIndexes.some((chapterIndex, position) => {
    const nextChapterIndex = chapterIndexes[position + 1] ?? entries.length;
    return entries.slice(chapterIndex + 1, nextChapterIndex).some((entry) => !isNumberedPdfChapterTitle(entry.title));
  });
  if (!chaptersHaveChildren) return entries.map((entry) => ({ ...entry, depth: 0 }));

  let insideChapter = false;
  return entries.map((entry) => {
    if (isNumberedPdfChapterTitle(entry.title)) {
      insideChapter = true;
      return { ...entry, depth: 0 };
    }
    return { ...entry, depth: insideChapter ? 1 : 0 };
  });
}

function isPdfTocPage(text: string) {
  const lines = pdfLines(text);
  if (!lines.length) return false;
  const heading = lines.slice(0, 20).some((line) => /^(?:table of )?contents\b/i.test(line));
  const dottedLeaders = lines.filter((line) => /(?:\.{3,}|…{2,})/.test(line)).length;
  const pageNumbers = lines.filter((line) => /^(?:\d+|[ivxlcdm]+)$/i.test(line)).length;
  const indexedTitles = lines.filter((line) => /(?:\.{2,}|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/i.test(line) && countWords(line) <= 18).length;
  const shortTitleLines = lines.filter((line) => countWords(line) >= 1 && countWords(line) <= 12 && !/[.!?][”"']?$/.test(line)).length;
  return heading
    || dottedLeaders >= 3
    || (indexedTitles >= 4 && indexedTitles / lines.length >= 0.15)
    || (pageNumbers >= 4 && shortTitleLines >= 5 && (pageNumbers + shortTitleLines) / lines.length >= 0.55);
}

function isPdfPublicationPage(text: string) {
  const normalized = normalizeText(text);
  const markers = normalized.match(/\b(?:copyright|all rights reserved|isbn|published by|printed in|edition|catalog(?:ing|uing)|library of congress|publisher)\b/gi)?.length || 0;
  return markers >= 2 || /^(?:copyright|publication information|imprint)\b/i.test(normalized);
}

function isPurePdfNavigationPage(text: string, title?: string) {
  const normalizedTitle = normalizeText(title || "").toLowerCase();
  if (!normalizedTitle) return false;
  const lines = pdfLines(text);
  const canonical = (value: string) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const joinedTitle = canonical(lines.join(" "));
  if (joinedTitle && joinedTitle === canonical(normalizedTitle) && countWords(joinedTitle) <= 20) return true;
  const remaining = lines.filter((line) => normalizeText(line).toLowerCase() !== normalizedTitle).join(" ");
  return lines.some((line) => normalizeText(line).toLowerCase() === normalizedTitle)
    && countWords(remaining) <= 4;
}

function sourcePagesForSection(section: ParsedSection) {
  return (section.locator || "")
    .split("|")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function sourceLocatorsForSection(section: ParsedSection) {
  return (section.locator || "")
    .split("|")
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("studyPart="));
}

function buildEpubNavigationEntries(sections: ParsedSection[], candidates: EpubNavigationCandidate[]): ParsedNavigationEntry[] {
  const directTargets = candidates.map((candidate) => sections.findIndex((section) => sourceLocatorsForSection(section).includes(candidate.entryPath)));
  return candidates.flatMap((candidate, candidateIndex) => {
    let targetOrderIndex = directTargets[candidateIndex];
    if (targetOrderIndex < 0) {
      for (let nextIndex = candidateIndex + 1; nextIndex < candidates.length; nextIndex += 1) {
        if (candidates[nextIndex].depth <= candidate.depth) break;
        if (directTargets[nextIndex] >= 0) {
          targetOrderIndex = directTargets[nextIndex];
          break;
        }
      }
    }
    if (targetOrderIndex < 0) return [];
    return [{ title: candidate.title, kind: candidate.kind, depth: candidate.depth, targetOrderIndex }];
  }).filter((entry, index, entries) => index === 0 || entry.title !== entries[index - 1].title || entry.depth !== entries[index - 1].depth || entry.targetOrderIndex !== entries[index - 1].targetOrderIndex);
}

function buildPdfNavigationEntries(sections: ParsedSection[], candidates: PdfNavigationCandidate[]): ParsedNavigationEntry[] {
  const entries: ParsedNavigationEntry[] = [];
  for (const candidate of candidates.sort((left, right) => left.sourcePage - right.sourcePage)) {
    let targetOrderIndex = sections.findIndex((section) => sourcePagesForSection(section).some((page) => page >= candidate.sourcePage));
    if (targetOrderIndex < 0) targetOrderIndex = sections.length - 1;
    if (targetOrderIndex < 0) continue;
    const duplicate = entries.some((entry) => entry.title === candidate.title && entry.targetOrderIndex === targetOrderIndex && entry.kind === candidate.kind && entry.depth === candidate.depth);
    if (!duplicate) entries.push({ ...candidate, targetOrderIndex });
  }
  return entries;
}

function repeatedPdfBoundaryLines(pages: Array<{ text: string }>) {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = pdfLines(page.text);
    const boundary = new Set([...lines.slice(0, 2), ...lines.slice(-2)]);
    for (const line of boundary) {
      if (line.length > 120 || countWords(line) > 16 || /^\d+$/.test(line)) continue;
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.25));
  return new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line));
}

function cleanPdfPageText(text: string, repeatedLines: Set<string>) {
  const dehyphenated = text.replace(/([A-Za-z])[-‐‑]\s*\n\s*([a-z])/g, "$1$2");
  return pdfLines(dehyphenated)
    .filter((line) => !repeatedLines.has(line) && !/^(?:page\s+)?\d+$/i.test(line))
    .join("\n");
}

function hasPossiblePdfLayoutIssue(text: string) {
  const lines = pdfLines(text);
  if (lines.length < 24) return false;
  const veryShort = lines.filter((line) => line.length < 38 && countWords(line) <= 7).length;
  return veryShort / lines.length >= 0.72;
}

function inferPdfChapterTitle(text: string) {
  const lines = text.split(/\r?\n/).map(normalizeText).filter(Boolean).slice(0, 8);
  return lines.find((line) => (
    countWords(line) <= 14
    && /^(chapter|part|book)\s+[\divxlcdm\w]+\b|^(introduction|preface|foreword|prologue|epilogue|acknowledgements?)\b/i.test(line)
  ));
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<ParsedBook> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // pdf.js does not reliably support page rendering and full-text extraction
    // concurrently on the same document. Render the first-page cover first.
    const renderedCover = await renderPdfCover(parser);
    const [textResult, infoResult] = await Promise.all([
      parser.getText(),
      parser.getInfo().catch(() => null),
    ]);
    const outlineEntries = await readPdfOutlineEntries(parser, infoResult?.outline);
    const outlinePages = new Map<number, PdfOutlineEntry>();
    for (const entry of outlineEntries) outlinePages.set(entry.page, entry);
    const reliableOutlineEntries = conservativePdfHierarchy(outlineEntries.filter((entry) => !isPdfDiscardedTitle(entry.title)));
    const hasReliableOutline = reliableOutlineEntries.length > 0;
    const firstOutlinePage = reliableOutlineEntries[0]?.page;
    const mainMatterStartPage = reliableOutlineEntries.find((entry) => isPdfMainMatterTitle(entry.title))?.page;
    const navigationCandidates: PdfNavigationCandidate[] = reliableOutlineEntries.map((entry) => ({
      title: entry.title,
      kind: (mainMatterStartPage && entry.page < mainMatterStartPage) || isPdfFrontMatterTitle(entry.title) ? "FRONT_MATTER" : "CHAPTER",
      sourcePage: entry.page,
      depth: entry.depth,
    }));
    const repeatedLines = repeatedPdfBoundaryLines(textResult.pages);
    let currentChapter: string | undefined;
    let currentFrontMatter = false;
    let technicalSectionsRemoved = 0;
    let filteredTocPageCount = 0;
    let suspectedScannedPageCount = 0;
    let suspectedLayoutIssueCount = 0;
    let frontMatterSectionCount = 0;
    const sections = textResult.pages.flatMap((page) => {
      const cleanedText = cleanPdfPageText(page.text, repeatedLines);
      const outlineEntry = outlinePages.get(page.num);
      const tocPage = isPdfTocPage(cleanedText);
      const leadingTechnicalPage = Boolean(firstOutlinePage && firstOutlinePage <= 15 && page.num < firstOutlinePage);
      const publicationPage = isPdfPublicationPage(cleanedText);
      const navigationOnlyPage = isPurePdfNavigationPage(cleanedText, outlineEntry?.title);
      if (tocPage || publicationPage || leadingTechnicalPage || navigationOnlyPage || isPdfDiscardedTitle(outlineEntry?.title)) {
        technicalSectionsRemoved += 1;
        if (tocPage || /contents/i.test(outlineEntry?.title || "")) filteredTocPageCount += 1;
        return [];
      }
      if (normalizeText(cleanedText).length < 20) suspectedScannedPageCount += 1;
      if (hasPossiblePdfLayoutIssue(cleanedText)) suspectedLayoutIssueCount += 1;

      if (outlineEntry) {
        currentChapter = outlineEntry.title;
        currentFrontMatter = (Boolean(mainMatterStartPage) && outlineEntry.page < (mainMatterStartPage || 0)) || isPdfFrontMatterTitle(outlineEntry.title);
      } else if (!hasReliableOutline) {
        const inferredTitle = inferPdfChapterTitle(cleanedText);
        if (inferredTitle) {
          currentChapter = inferredTitle;
          currentFrontMatter = isPdfFrontMatterTitle(inferredTitle);
        }
      }
      if (currentFrontMatter) frontMatterSectionCount += 1;
      return [{
        title: `Page ${page.num}`,
        chapterTitle: currentChapter,
        kind: currentFrontMatter ? "FRONT_MATTER" as const : "PAGE" as const,
        locator: String(page.num),
        paragraphs: normalizeText(cleanedText).split(/\n\s*\n|\n(?=[A-Z])/).map(normalizeText).filter(Boolean),
      }];
    });
    const extractedLength = sections.reduce((sum, section) => sum + section.paragraphs.join(" ").length, 0);
    if (!sections.length || extractedLength < 50) {
      throw new Error("该 PDF 可能是扫描版或没有可提取文字，当前版本暂不支持 OCR");
    }
    const title = infoResult?.info?.Title || path.parse(fileName).name;
    const author = infoResult?.info?.Author || undefined;
    const parsed = finalizeParsedBook({
      title,
      author,
      format: "PDF",
      sections,
      cover: renderedCover || createTextCover(title, author),
      parserVersion: 9,
      cleanupSummary: {
        technicalSectionsRemoved,
        frontMatterSectionCount,
        outlineEntryCount: outlineEntries.length,
        filteredTocPageCount,
        suspectedScannedPageCount,
        suspectedLayoutIssueCount,
      },
    });
    return {
      ...parsed,
      navigationEntries: buildPdfNavigationEntries(parsed.sections, navigationCandidates),
    };
  } finally {
    await parser.destroy();
  }
}

export async function extractBookCover(
  buffer: Buffer,
  fileName: string,
  format: string,
  title: string,
  author?: string | null,
): Promise<BookCover> {
  if (format === "PDF") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return (await renderPdfCover(parser)) || createTextCover(title, author);
    } finally {
      await parser.destroy();
    }
  }
  if (format === "EPUB") {
    const zip = await JSZip.loadAsync(buffer);
    const { packagePath, nodes } = await loadEpubPackage(zip);
    return (await readEpubCover(zip, packagePath, nodes as unknown as Array<Element>)) || createTextCover(title, author);
  }
  return createTextCover(title, author);
}

export async function parseBook(buffer: Buffer, fileName: string, mimeType: string): Promise<ParsedBook> {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".epub" || mimeType === "application/epub+zip") return parseEpub(buffer, fileName);
  if (extension === ".pdf" || mimeType === "application/pdf") return parsePdf(buffer, fileName);
  if (extension === ".txt" || mimeType.startsWith("text/plain")) {
    const title = path.parse(fileName).name;
    const text = buffer.toString("utf8");
    if (normalizeText(text).length < 20) throw new Error("TXT 文件没有足够的可阅读内容");
    return finalizeParsedBook({ title, format: "TXT", sections: textToSections(text, "Section"), cover: createTextCover(title) });
  }
  throw new Error("仅支持 EPUB、PDF 和 TXT 文件");
}

export function countWords(text: string) { return (text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).length; }

export const toSegments = (paragraphs: string[]) =>
  paragraphs.map((text, orderIndex) => ({ text, orderIndex, wordCount: countWords(text) }));
