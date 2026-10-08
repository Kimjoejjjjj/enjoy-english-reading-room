export interface ReaderNavigationTarget {
  sectionId: string;
  highlightId?: string;
  segmentId?: string;
  locator?: string | null;
}

export interface ReaderRange {
  segmentId: string;
  start: number;
  end: number;
}

export interface ReaderSegment {
  id: string;
  text: string;
}

export interface HighlightRangeSource {
  segmentId?: string | null;
  quote?: string | null;
  locator?: string | null;
}

export interface PendingReaderNavigation {
  requestId: number;
  target: ReaderNavigationTarget;
}

export interface HighlightNavigationRecord {
  id: string;
  segmentId?: string | null;
  locator?: string | null;
  section?: { id: string } | null;
}

export interface VocabularyNavigationRecord {
  segmentId?: string | null;
  section?: { id: string } | null;
}

export function isValidReaderRange(
  range: Partial<ReaderRange> | null | undefined,
  segments: ReaderSegment[],
): range is ReaderRange {
  if (
    !range
    || typeof range.segmentId !== "string"
    || typeof range.start !== "number"
    || typeof range.end !== "number"
    || !Number.isInteger(range.start)
    || !Number.isInteger(range.end)
    || range.start < 0
    || range.end <= range.start
  ) return false;
  const segment = segments.find((item) => item.id === range.segmentId);
  return Boolean(segment && range.end <= segment.text.length);
}

export function parseReaderLocator(value?: string | null): ReaderRange[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; ranges?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.ranges)) return null;
    const ranges = parsed.ranges.filter((item): item is ReaderRange => {
      const candidate = item as Partial<ReaderRange> | null;
      return typeof candidate?.segmentId === "string"
        && Number.isInteger(candidate.start)
        && Number.isInteger(candidate.end);
    });
    return ranges.length === parsed.ranges.length && ranges.length > 0 ? ranges : null;
  } catch {
    return null;
  }
}

export function resolveReaderRanges(
  segments: ReaderSegment[],
  highlight: HighlightRangeSource,
  fallbackLocator?: string | null,
): ReaderRange[] {
  const locator = parseReaderLocator(highlight.locator || fallbackLocator);
  if (locator && locator.every((range) => isValidReaderRange(range, segments))) return locator;
  if (!highlight.segmentId || !highlight.quote) return [];
  const segment = segments.find((item) => item.id === highlight.segmentId);
  const start = segment?.text.indexOf(highlight.quote) ?? -1;
  const fallback = segment && start >= 0
    ? { segmentId: highlight.segmentId, start, end: start + highlight.quote.length }
    : null;
  return isValidReaderRange(fallback, segments) ? [fallback] : [];
}

export function getHighlightNavigationTarget(record: HighlightNavigationRecord): ReaderNavigationTarget | null {
  if (!record.section?.id) return null;
  return {
    sectionId: record.section.id,
    highlightId: record.id,
    segmentId: record.segmentId || undefined,
    locator: record.locator,
  };
}

export function getVocabularyNavigationTarget(record: VocabularyNavigationRecord): ReaderNavigationTarget | null {
  if (!record.section?.id || !record.segmentId) return null;
  return { sectionId: record.section.id, segmentId: record.segmentId };
}

export function createPendingReaderNavigation(requestId: number, target: ReaderNavigationTarget): PendingReaderNavigation {
  return { requestId, target };
}

export function shouldConsumeReaderNavigation(
  pending: PendingReaderNavigation | null,
  renderedSectionId: string | null,
): pending is PendingReaderNavigation {
  return Boolean(pending && renderedSectionId && pending.target.sectionId === renderedSectionId);
}

export function isCurrentSectionLoad(
  requestId: number,
  requestedSectionId: string,
  latestRequestId: number,
  currentSectionId: string | null,
): boolean {
  return requestId === latestRequestId && requestedSectionId === currentSectionId;
}

export function resolveSectionLoadFailure(
  requestId: number,
  requestedSectionId: string,
  latestRequestId: number,
  currentSectionId: string | null,
  pendingTargetSectionId: string | null,
  transitionTargetSectionId: string | null,
) {
  const handled = isCurrentSectionLoad(requestId, requestedSectionId, latestRequestId, currentSectionId);
  return {
    handled,
    clearPending: handled && pendingTargetSectionId === requestedSectionId,
    clearTransition: handled && transitionTargetSectionId === requestedSectionId,
  };
}

export function shouldCommitSectionTransition(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function shouldClearSectionTransition(
  requestId: number,
  latestRequestId: number,
  targetRequestId: number | null,
): boolean {
  return shouldCommitSectionTransition(requestId, latestRequestId) && targetRequestId === requestId;
}

export function shouldApplySectionNotesRequest(
  requestId: number,
  latestRequestId: number,
  requestKey: string,
  latestRequestKey: string | null,
  mounted = true,
): boolean {
  return mounted && requestId === latestRequestId && requestKey === latestRequestKey;
}
