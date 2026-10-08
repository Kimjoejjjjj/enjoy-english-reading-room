import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { getCoverStorageDirectory, resolveCoverPath } from "@/lib/app-storage";

export type CoverExtension = "png" | "jpg" | "webp" | "svg";

export interface BookCover {
  data: Buffer;
  extension: CoverExtension;
  mimeType: string;
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const wrapTitle = (value: string, max = 22) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 5);
};

export function createTextCover(title: string, author?: string | null): BookCover {
  const lines = wrapTitle(title || "Untitled Book");
  const titleNodes = lines
    .map((line, index) => `<text x="300" y="${285 + index * 62}" text-anchor="middle" class="title">${escapeXml(line)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dbeafe"/><stop offset="1" stop-color="#c7d2fe"/></linearGradient></defs>
  <rect width="600" height="900" rx="24" fill="url(#g)"/>
  <rect x="42" y="42" width="516" height="816" rx="18" fill="none" stroke="#3730a3" stroke-opacity=".22" stroke-width="3"/>
  <text x="300" y="150" text-anchor="middle" class="eyebrow">ENGLISH READING</text>
  ${titleNodes}
  <line x1="190" x2="410" y1="650" y2="650" stroke="#3730a3" stroke-opacity=".35"/>
  <text x="300" y="715" text-anchor="middle" class="author">${escapeXml(author || "Unknown author")}</text>
  <style>.title{font:700 42px Georgia,serif;fill:#1e1b4b}.author{font:24px Arial,sans-serif;fill:#4338ca}.eyebrow{font:700 17px Arial,sans-serif;letter-spacing:4px;fill:#6366f1}</style>
  </svg>`;
  return { data: Buffer.from(svg, "utf8"), extension: "svg", mimeType: "image/svg+xml" };
}

export function detectRasterCover(data: Buffer): BookCover | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { data, extension: "png", mimeType: "image/png" };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { data, extension: "jpg", mimeType: "image/jpeg" };
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { data, extension: "webp", mimeType: "image/webp" };
  }
  return null;
}

export async function saveBookCover(cover: BookCover): Promise<string> {
  const directory = getCoverStorageDirectory();
  await mkdir(directory, { recursive: true });
  const fileName = `cover_${randomBytes(10).toString("hex")}.${cover.extension}`;
  await writeFile(path.join(directory, fileName), cover.data);
  return `/api/book-covers/${fileName}`;
}

export async function deleteStoredCover(coverUrl?: string | null) {
  const prefixes = ["/uploads/books/covers/", "/api/book-covers/"];
  const prefix = prefixes.find((candidate) => coverUrl?.startsWith(candidate));
  if (!coverUrl || !prefix) return;
  const fileName = coverUrl.slice(prefix.length);
  if (!/^cover_[a-f0-9]+\.(png|jpg|webp|svg)$/.test(fileName)) return;
  const filePath = await resolveCoverPath(fileName).catch(() => null);
  if (filePath) await unlink(filePath).catch(() => undefined);
}
