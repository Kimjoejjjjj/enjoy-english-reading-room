import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countWords, parseBook, toSegments } from "@/lib/book-parser";
import { anchorPositions } from "@/lib/reparse-anchor";
import { readingWrite } from "@/lib/reading-write";
import { isUuid } from "@/lib/reading-ledger-contract";
import { resolveBookSourcePath } from "@/lib/app-storage";

type Context = { params: Promise<{ id: string }> };
type StoredRange = { segmentId: string; start: number; end: number };
type DirectoryPreviewEntry = { title: string; depth: number; targetOrderIndex?: number };

const mimeTypes: Record<string, string> = {
  EPUB: "application/epub+zip",
  PDF: "application/pdf",
  TXT: "text/plain",
};

function parseRanges(locator?: string | null): StoredRange[] {
  if (!locator) return [];
  try {
    const parsed = JSON.parse(locator) as { version?: number; ranges?: StoredRange[] };
    return parsed.version === 1 && Array.isArray(parsed.ranges) ? parsed.ranges : [];
  } catch {
    return [];
  }
}

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) => Array.isArray(item) && item.every((row: unknown) => row && typeof row === "object" && "id" in row) ? [...item].sort((a, b) => String(a.id).localeCompare(String(b.id))) : item)).digest("hex");

function storedDirectory(value?: string | null): DirectoryPreviewEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<Record<string, unknown>>;
    return Array.isArray(parsed) ? parsed.flatMap((entry) => {
      if (typeof entry.title !== "string") return [];
      return [{
        title: entry.title,
        depth: Math.min(6, Math.max(0, Number.isInteger(entry.depth) ? Number(entry.depth) : 0)),
        targetOrderIndex: Number.isInteger(entry.targetOrderIndex) ? Number(entry.targetOrderIndex) : undefined,
      }];
    }) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const book = await prisma.content.findUnique({ where: { id } });
  if (!book || book.userId !== userId || book.source !== "UPLOAD") {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  if (body.confirmReset === true && isUuid(body.batchId)) {
    const priorBatch = await prisma.reparseBatch.findUnique({ where: { batchId: body.batchId } });
    if (priorBatch) {
      if (priorBatch.userId !== userId || priorBatch.contentId !== id || priorBatch.contentFingerprint !== body.contentFingerprint || priorBatch.protectedFingerprint !== body.protectedFingerprint) return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
      return NextResponse.json({ ...JSON.parse(priorBatch.resultJson), replayed: true });
    }
  }
  const filePath = await resolveBookSourcePath(book.fileUrl).catch(() => null);
  if (!filePath) return NextResponse.json({ error: "原始书籍文件不可用，无法优化阅读分页" }, { status: 400 });

  try {
    const [buffer, oldSections, progressRows, sectionProgressRows, highlightRows, occurrenceRows, eventRows, sessionRows, deltaRows, activeLease] = await Promise.all([
      readFile(filePath),
      prisma.contentSection.findMany({ where: { contentId: id }, include: { segments: true }, orderBy: { orderIndex: "asc" } }),
      prisma.readingProgress.findMany({ where: { userId, contentId: id } }),
      prisma.sectionProgress.findMany({ where: { userId, contentId: id } }),
      prisma.highlight.findMany({ where: { userId, contentId: id } }),
      prisma.vocabularyOccurrence.findMany({ where: { contentId: id, userVocabulary: { userId } } }),
      prisma.learningEvent.findMany({ where: { userId, contentId: id } }),
      prisma.readingSession.findMany({ where: { userId, contentId: id } }),
      prisma.readingTimeDelta.findMany({ where: { userId, contentId: id } }),
      prisma.readingLease.findFirst({ where: { userId, session: { contentId: id }, leaseExpiresAt: { gt: new Date() } } }),
    ]);
    const parsed = await parseBook(buffer, path.basename(filePath), mimeTypes[book.format] || "application/octet-stream");
    const parsedTexts = parsed.sections.map((section) => section.paragraphs.join("\n\n"));
    const parsedSegments = parsed.sections.map((section) => toSegments(section.paragraphs));
    const oldSegments = new Map(oldSections.flatMap((section) => section.segments.map((segment) => [segment.id, segment.text] as const)));

    const findParsedCandidates = (target: string) => parsedTexts.flatMap((text, index) => anchorPositions(text, target).map((position) => ({ index, ...position })));
    const findUniqueParsedIndex = (target: string) => {
      const candidates = findParsedCandidates(target);
      return candidates.length === 1 ? candidates[0].index : null;
    };
    const findSegmentCandidates = (target: string) => parsedSegments.flatMap((segments, sectionIndex) => segments.flatMap((segment, segmentIndex) => anchorPositions(segment.text, target).map((position) => ({ sectionIndex, segmentIndex, ...position }))));
    const highlightFragments = highlightRows.map((highlight) => {
      const ranges = parseRanges(highlight.locator);
      const fragments = ranges.map((range) => oldSegments.get(range.segmentId)?.slice(range.start, range.end) || "").filter(Boolean);
      return { id: highlight.id, sectionId: highlight.sectionId, fragments: fragments.length ? fragments : [highlight.quote] };
    });
    const unmatchedHighlights = highlightFragments.filter((highlight) => highlight.fragments.some((fragment) => findSegmentCandidates(fragment).length !== 1));
    const unmatchedOccurrences = occurrenceRows.filter((occurrence) => findSegmentCandidates(occurrence.context || occurrence.selectedText).length !== 1);
    const protectedSectionIds = new Set<string>([
      ...progressRows.flatMap((row) => row.sectionId ? [row.sectionId] : []),
      ...sectionProgressRows.map((row) => row.sectionId),
      ...eventRows.flatMap((row) => row.sectionId ? [row.sectionId] : []),
      ...sessionRows.flatMap((row) => row.currentSectionId ? [row.currentSectionId] : []),
      ...deltaRows.flatMap((row) => row.sectionId ? [row.sectionId] : []),
    ]);
    const ambiguousProtectedSections = [...protectedSectionIds].filter((sectionId) => {
      const section = oldSections.find((item) => item.id === sectionId);
      return !section || findUniqueParsedIndex(section.plainText) === null;
    });
    const activeSessionCount = sessionRows.filter((row) => row.status === "OPEN").length;
    const contentShape = (source: { parserVersion: number; fileUrl: string }, sections: Array<{ id: string; orderIndex: number; plainText: string }>, bytes: Buffer) => ({ userId, contentId: id, parserVersion: source.parserVersion, targetParserVersion: parsed.parserVersion, fileUrl: source.fileUrl, fileHash: createHash("sha256").update(bytes).digest("hex"), sections: sections.map((section) => ({ id: section.id, orderIndex: section.orderIndex, textHash: fingerprint(section.plainText) })) });
    const contentFingerprint = fingerprint(contentShape(book, oldSections, buffer));
    const protectedFingerprint = fingerprint({ progressRows, sectionProgressRows, highlightRows, occurrenceRows, eventRows, sessionRows, deltaRows });
    const learningRecords = {
      progressCount: progressRows.length,
      sectionProgressCount: sectionProgressRows.length,
      highlightCount: highlightRows.length,
      occurrenceCount: occurrenceRows.length,
      eventCount: eventRows.length,
      sessionCount: sessionRows.length,
      deltaCount: deltaRows.length,
    };
    const preview = {
      oldPartCount: oldSections.length,
      newPartCount: parsed.sections.length,
      chapterCount: parsed.cleanupSummary.chapterCount,
      frontMatterCount: parsed.cleanupSummary.frontMatterSectionCount,
      filteredTechnicalCount: parsed.cleanupSummary.technicalSectionsRemoved,
      outlineEntryCount: parsed.cleanupSummary.outlineEntryCount,
      filteredTocPageCount: parsed.cleanupSummary.filteredTocPageCount,
      suspectedScannedPageCount: parsed.cleanupSummary.suspectedScannedPageCount,
      suspectedLayoutIssueCount: parsed.cleanupSummary.suspectedLayoutIssueCount,
      unmatchedHighlightCount: unmatchedHighlights.length,
      unmatchedOccurrenceCount: unmatchedOccurrences.length,
      ambiguousProtectedSectionCount: ambiguousProtectedSections.length,
      activeSessionCount,
      oldDirectory: storedDirectory(book.navigationJson).length
        ? storedDirectory(book.navigationJson)
        : oldSections
          .filter((section, index) => index === 0 || section.chapterTitle !== oldSections[index - 1]?.chapterTitle || section.kind !== oldSections[index - 1]?.kind)
          .map((section) => ({ title: section.chapterTitle || section.title, depth: 0, targetOrderIndex: section.orderIndex })),
      newDirectory: parsed.navigationEntries.length
        ? parsed.navigationEntries.map((entry) => ({ title: entry.title, depth: entry.depth, targetOrderIndex: entry.targetOrderIndex }))
        : parsed.sections
          .filter((section, index) => index === 0 || section.chapterTitle !== parsed.sections[index - 1]?.chapterTitle || section.kind !== parsed.sections[index - 1]?.kind)
          .map((section, index) => ({ title: section.chapterTitle || section.title, depth: 0, targetOrderIndex: index })),
    };
    const hasLearningRecords = Object.values(learningRecords).some((value) => value > 0);

    if (body.confirmReset !== true) {
      return NextResponse.json({
        error: hasLearningRecords
          ? "这本书已有阅读记录。确认后会优化目录与分页，并安全迁移现有高亮、笔记、生词来源、进度和阅读时长。"
          : "已完成目录与分页预检。确认后才会替换当前解析结果。",
        requiresConfirmation: true,
        canConfirm: unmatchedHighlights.length === 0 && unmatchedOccurrences.length === 0 && ambiguousProtectedSections.length === 0 && activeSessionCount === 0 && !activeLease,
        learningRecords,
        preview,
        contentFingerprint,
        protectedFingerprint,
      }, { status: 409 });
    }
    if (!isUuid(body.batchId) || body.contentFingerprint !== contentFingerprint || body.protectedFingerprint !== protectedFingerprint) {
      return NextResponse.json({ error: "重解析预览已失效，请重新预检" }, { status: 409 });
    }
    if (unmatchedHighlights.length || unmatchedOccurrences.length || ambiguousProtectedSections.length || activeSessionCount || activeLease) {
      return NextResponse.json({
        error: activeSessionCount || activeLease ? "这本书仍有活动阅读会话，请退出阅读后重新预检。" : "部分受保护记录无法唯一定位，已取消优化，原分页保持不变。",
        migrationBlocked: true,
        preview,
      }, { status: 422 });
    }

    const wordCount = parsed.sections.reduce(
      (total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0),
      0,
    );

    const updated = await readingWrite(userId, async (tx) => {
      const replay = await tx.reparseBatch.findUnique({ where: { batchId: body.batchId } });
      if (replay) {
        if (replay.userId !== userId || replay.contentId !== id || replay.contentFingerprint !== body.contentFingerprint || replay.protectedFingerprint !== body.protectedFingerprint) throw new Error("批次绑定不一致");
        return { ...JSON.parse(replay.resultJson), replayed: true };
      }
      const freshBook = await tx.content.findUnique({ where: { id } });
      const freshSections = await tx.contentSection.findMany({ where: { contentId: id }, orderBy: { orderIndex: "asc" } });
      if (!freshBook || freshBook.userId !== userId || fingerprint(contentShape(freshBook, freshSections, await readFile(filePath))) !== contentFingerprint) throw new Error("书籍内容已变化，请重新预检");
      const [freshProgress, freshSectionProgress, freshHighlights, freshOccurrences, freshEvents, freshSessions, freshDeltas, freshLease] = await Promise.all([
        tx.readingProgress.findMany({ where: { userId, contentId: id } }),
        tx.sectionProgress.findMany({ where: { userId, contentId: id } }),
        tx.highlight.findMany({ where: { userId, contentId: id } }),
        tx.vocabularyOccurrence.findMany({ where: { contentId: id, userVocabulary: { userId } } }),
        tx.learningEvent.findMany({ where: { userId, contentId: id } }),
        tx.readingSession.findMany({ where: { userId, contentId: id } }),
        tx.readingTimeDelta.findMany({ where: { userId, contentId: id } }),
        tx.readingLease.findFirst({ where: { userId, session: { contentId: id }, leaseExpiresAt: { gt: new Date() } } }),
      ]);
      const freshFingerprint = fingerprint({ progressRows: freshProgress, sectionProgressRows: freshSectionProgress, highlightRows: freshHighlights, occurrenceRows: freshOccurrences, eventRows: freshEvents, sessionRows: freshSessions, deltaRows: freshDeltas });
      if (freshFingerprint !== protectedFingerprint || freshLease || freshSessions.some((row) => row.status === "OPEN")) throw new Error("受保护记录已变化，请重新预检");
      await tx.contentSection.deleteMany({ where: { contentId: id } });
      for (const [orderIndex, source] of parsed.sections.entries()) {
        const plainText = source.paragraphs.join("\n\n");
        await tx.contentSection.create({
          data: {
            contentId: id,
            orderIndex,
            title: source.title,
            chapterTitle: source.chapterTitle || null,
            kind: source.kind,
            locator: source.locator || null,
            plainText,
            wordCount: countWords(plainText),
            segments: { create: toSegments(source.paragraphs) },
          },
        });
      }

      const newSections = await tx.contentSection.findMany({ where: { contentId: id }, include: { segments: true }, orderBy: { orderIndex: "asc" } });
      const findNewLocation = (target: string) => {
        const candidates = findSegmentCandidates(target);
        if (candidates.length !== 1) return null;
        const candidate = candidates[0];
        const section = newSections[candidate.sectionIndex];
        const segment = section?.segments.find((item) => item.orderIndex === candidate.segmentIndex);
        return section && segment ? { section, segment, start: candidate.start, end: candidate.end } : null;
      };

      for (const highlight of highlightRows) {
        const snapshot = highlightFragments.find((item) => item.id === highlight.id)!;
        const ranges: StoredRange[] = [];
        let firstSegmentId: string | null = null;
        let targetSectionId: string | null = null;
        for (const fragment of snapshot.fragments) {
          const match = findNewLocation(fragment);
          if (!match?.segment) throw new Error("高亮定位在事务中发生变化，优化已取消");
          const start = match.start;
          if (targetSectionId && targetSectionId !== match.section.id) throw new Error("跨页高亮无法安全迁移");
          targetSectionId ||= match.section.id;
          firstSegmentId ||= match.segment.id;
          ranges.push({ segmentId: match.segment.id, start, end: match.end });
        }
        await tx.highlight.update({
          where: { id: highlight.id },
          data: { sectionId: targetSectionId, segmentId: firstSegmentId, locator: JSON.stringify({ version: 1, ranges }) },
        });
      }

      for (const occurrence of occurrenceRows) {
        const match = findNewLocation(occurrence.context || occurrence.selectedText);
        if (!match) throw new Error("生词来源定位在事务中发生变化，优化已取消");
        const segment = match.segment;
        await tx.vocabularyOccurrence.update({ where: { id: occurrence.id }, data: { sectionId: match.section.id, segmentId: segment?.id || null } });
      }

      const oldToNew = new Map<string, string>();
      for (const oldSection of oldSections) {
        const index = findUniqueParsedIndex(oldSection.plainText);
        const target = index === null ? null : newSections[index];
        if (target) oldToNew.set(oldSection.id, target.id);
      }
      for (const progress of progressRows) {
        const targetId = progress.sectionId ? oldToNew.get(progress.sectionId) : null;
        if (progress.sectionId && !targetId) throw new Error("阅读进度无法唯一迁移，优化已取消");
        await tx.readingProgress.update({ where: { id: progress.id }, data: { sectionId: targetId || null } });
      }
      for (const event of eventRows) {
        if (!event.sectionId) continue;
        const targetId = oldToNew.get(event.sectionId);
        if (!targetId) throw new Error("学习事件无法唯一迁移，优化已取消");
        await tx.learningEvent.update({ where: { id: event.id }, data: { sectionId: targetId } });
      }

      for (const session of sessionRows) {
        if (!session.currentSectionId) continue;
        const targetId = oldToNew.get(session.currentSectionId);
        if (!targetId) throw new Error("阅读会话无法唯一迁移，优化已取消");
        await tx.readingSession.update({ where: { id: session.id }, data: { currentSectionId: targetId } });
      }
      for (const delta of deltaRows) {
        if (!delta.sectionId) continue;
        const targetId = oldToNew.get(delta.sectionId);
        if (!targetId) throw new Error("阅读时间引用无法唯一迁移，优化已取消");
        await tx.readingTimeDelta.update({ where: { id: delta.id }, data: { sectionId: targetId } });
      }

      const sectionProgressByTarget = new Map<string, typeof sectionProgressRows>();
      for (const row of sectionProgressRows) {
        const targetId = oldToNew.get(row.sectionId);
        if (!targetId) continue;
        sectionProgressByTarget.set(targetId, [...(sectionProgressByTarget.get(targetId) || []), row]);
      }
      for (const [targetId, rows] of sectionProgressByTarget) {
        const completedRows = rows.filter((row) => row.status === "COMPLETED");
        await tx.sectionProgress.create({
          data: {
            userId,
            contentId: id,
            sectionId: targetId,
            status: completedRows.length === rows.length ? "COMPLETED" : "READING",
            secondsSpent: rows.reduce((sum, row) => sum + row.secondsSpent, 0),
            lookupCount: rows.reduce((sum, row) => sum + row.lookupCount, 0),
            savedWordCount: rows.reduce((sum, row) => sum + row.savedWordCount, 0),
            highlightCount: rows.reduce((sum, row) => sum + row.highlightCount, 0),
            lastQuizScore: rows.find((row) => row.lastQuizScore !== null)?.lastQuizScore || null,
            bestQuizScore: Math.max(...rows.map((row) => row.bestQuizScore || 0)) || null,
            completedAt: completedRows.map((row) => row.completedAt).filter((value): value is Date => Boolean(value)).sort((left, right) => right.getTime() - left.getTime())[0] || null,
            lastStudiedAt: rows.map((row) => row.lastStudiedAt).sort((left, right) => right.getTime() - left.getTime())[0],
          },
        });
      }

      const [migratedHighlights, migratedOccurrences, migratedEvents, migratedSessions, migratedDeltas, migratedProgress, migratedSectionProgress] = await Promise.all([
        tx.highlight.count({ where: { userId, contentId: id } }), tx.vocabularyOccurrence.count({ where: { contentId: id, userVocabulary: { userId } } }),
        tx.learningEvent.count({ where: { userId, contentId: id } }), tx.readingSession.count({ where: { userId, contentId: id } }),
        tx.readingTimeDelta.aggregate({ where: { userId, contentId: id }, _sum: { seconds: true }, _count: true }),
        tx.readingProgress.count({ where: { userId, contentId: id } }), tx.sectionProgress.count({ where: { userId, contentId: id } }),
      ]);
      if (migratedHighlights !== highlightRows.length || migratedOccurrences !== occurrenceRows.length || migratedEvents !== eventRows.length || migratedSessions !== sessionRows.length || migratedDeltas._count !== deltaRows.length || (migratedDeltas._sum.seconds || 0) !== deltaRows.reduce((sum, row) => sum + row.seconds, 0) || migratedProgress !== progressRows.length || migratedSectionProgress !== sectionProgressByTarget.size) throw new Error("迁移数量或时长校验失败");
      const content = await tx.content.update({
        where: { id },
        data: {
          parserVersion: parsed.parserVersion,
          navigationJson: parsed.navigationEntries.length ? JSON.stringify(parsed.navigationEntries) : null,
          sourceSectionCount: parsed.sourceSectionCount,
          sectionCount: parsed.sections.length,
          wordCount,
          status: "READY",
          errorMessage: null,
        },
      });
      const result = { book: content, migratedLearningRecords: hasLearningRecords, previousLearningRecords: learningRecords, preview };
      await tx.reparseBatch.create({ data: { batchId: body.batchId, userId, contentId: id, contentFingerprint, protectedFingerprint, resultJson: JSON.stringify(result) } });
      return result;
    }, 300_000);

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "优化阅读分页失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
