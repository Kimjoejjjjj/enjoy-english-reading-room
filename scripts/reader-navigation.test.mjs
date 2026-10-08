import assert from "node:assert/strict";
import test from "node:test";
import { getStableChapterBoundary } from "../src/lib/chapter-boundary.ts";
import {
  createPendingReaderNavigation,
  getHighlightNavigationTarget,
  getVocabularyNavigationTarget,
  isValidReaderRange,
  parseReaderLocator,
  resolveReaderRanges,
  resolveSectionLoadFailure,
  shouldClearSectionTransition,
  shouldApplySectionNotesRequest,
  shouldCommitSectionTransition,
  shouldConsumeReaderNavigation,
} from "../src/lib/reader-navigation.ts";

test("resolves complete highlight and vocabulary navigation targets", () => {
  const highlightTarget = getHighlightNavigationTarget({
    id: "highlight-1",
    segmentId: "segment-1",
    locator: JSON.stringify({ version: 1, ranges: [{ segmentId: "segment-1", start: 2, end: 8 }] }),
    section: { id: "section-middle" },
  });
  assert.deepEqual(highlightTarget, {
    sectionId: "section-middle",
    highlightId: "highlight-1",
    segmentId: "segment-1",
    locator: JSON.stringify({ version: 1, ranges: [{ segmentId: "segment-1", start: 2, end: 8 }] }),
  });
  assert.deepEqual(getVocabularyNavigationTarget({ section: { id: "section-last" }, segmentId: "segment-last" }), {
    sectionId: "section-last",
    segmentId: "segment-last",
  });
  assert.equal(getHighlightNavigationTarget({ id: "legacy-highlight", section: null }), null);
  assert.equal(getVocabularyNavigationTarget({ section: { id: "section-first" }, segmentId: null }), null);
});

test("consumes only the latest pending target after its section is rendered", () => {
  const first = createPendingReaderNavigation(1, { sectionId: "section-first", segmentId: "segment-first" });
  const latest = createPendingReaderNavigation(2, { sectionId: "section-last", segmentId: "segment-last" });
  assert.equal(shouldConsumeReaderNavigation(first, "section-first"), true);
  assert.equal(shouldConsumeReaderNavigation(latest, "section-first"), false);
  assert.equal(shouldConsumeReaderNavigation(latest, "section-last"), true);
});

test("accepts a valid locator range without changing it", () => {
  const segments = [{ id: "segment-1", text: "hello world" }];
  const locator = JSON.stringify({ version: 1, ranges: [{ segmentId: "segment-1", start: 2, end: 5 }] });
  assert.deepEqual(parseReaderLocator(locator), [{ segmentId: "segment-1", start: 2, end: 5 }]);
  assert.equal(isValidReaderRange({ segmentId: "segment-1", start: 2, end: 5 }, segments), true);
  assert.deepEqual(resolveReaderRanges(segments, { segmentId: "segment-1", quote: "llo", locator }), [{ segmentId: "segment-1", start: 2, end: 5 }]);
});

test("rejects an unknown locator segment", () => {
  const segments = [{ id: "segment-1", text: "hello world" }];
  assert.equal(isValidReaderRange({ segmentId: "missing", start: 0, end: 3 }, segments), false);
  assert.deepEqual(resolveReaderRanges(segments, {
    segmentId: "missing",
    quote: "not present",
    locator: JSON.stringify({ version: 1, ranges: [{ segmentId: "missing", start: 0, end: 3 }] }),
  }), []);
});

test("rejects negative, empty, reversed, and oversized ranges without clamping", () => {
  const segments = [{ id: "segment-1", text: "hello" }];
  for (const range of [
    { segmentId: "segment-1", start: -1, end: 2 },
    { segmentId: "segment-1", start: 2, end: 2 },
    { segmentId: "segment-1", start: 4, end: 3 },
    { segmentId: "segment-1", start: 1, end: 99 },
  ]) {
    assert.equal(isValidReaderRange(range, segments), false);
    assert.deepEqual(resolveReaderRanges(segments, {
      segmentId: "segment-1",
      quote: "not present",
      locator: JSON.stringify({ version: 1, ranges: [range] }),
    }), []);
  }
});

test("uses only a safe segment-plus-quote fallback when locator is invalid", () => {
  const segments = [{ id: "segment-1", text: "hello world" }];
  assert.deepEqual(resolveReaderRanges(segments, {
    segmentId: "segment-1",
    quote: "world",
    locator: JSON.stringify({ version: 1, ranges: [{ segmentId: "segment-1", start: 0, end: 999 }] }),
  }), [{ segmentId: "segment-1", start: 6, end: 11 }]);
  assert.deepEqual(resolveReaderRanges(segments, {
    segmentId: "segment-1",
    quote: "missing",
    locator: JSON.stringify({ version: 1, ranges: [{ segmentId: "segment-1", start: 0, end: 999 }] }),
  }), []);
});

test("uses one failure boundary for 404, 500, JSON, and network section errors", () => {
  for (const cause of ["404", "500", "invalid-json", "network"]) {
    const resolution = resolveSectionLoadFailure(7, "section-target", 7, "section-target", "section-target", "section-target");
    assert.deepEqual(resolution, { handled: true, clearPending: true, clearTransition: true }, cause);
  }
  assert.deepEqual(resolveSectionLoadFailure(6, "section-old", 7, "section-target", "section-target", "section-target"), {
    handled: false,
    clearPending: false,
    clearTransition: false,
  });
});

test("manual A-to-B transition commits only the latest flush", () => {
  assert.equal(shouldCommitSectionTransition(1, 2), false);
  assert.equal(shouldCommitSectionTransition(2, 2), true);
});

test("record navigation and manual navigation share last-intent-wins transition ordering", () => {
  assert.equal(shouldCommitSectionTransition(4, 5), false);
  assert.equal(shouldCommitSectionTransition(5, 5), true);
  assert.equal(shouldConsumeReaderNavigation(createPendingReaderNavigation(5, { sectionId: "section-b", segmentId: "segment-b" }), "section-b"), true);
});

test("complete-and-move stops before the complete request when its flush loses the race", () => {
  assert.equal(shouldCommitSectionTransition(10, 11), false);
});

test("complete-and-move ignores a stale complete response after a newer section or record intent", () => {
  assert.equal(shouldCommitSectionTransition(12, 13), false);
  assert.equal(shouldClearSectionTransition(12, 13, 12), false);
});

test("complete-and-move latest response may advance or finish, and only its cleanup may clear it", () => {
  assert.equal(shouldCommitSectionTransition(14, 14), true);
  assert.equal(shouldClearSectionTransition(14, 14, 14), true);
  assert.equal(shouldClearSectionTransition(14, 15, 14), false);
});

test("chapter notes applies only the newest content-section request", () => {
  assert.equal(shouldApplySectionNotesRequest(2, 2, "book:section-b", "book:section-b"), true);
  assert.equal(shouldApplySectionNotesRequest(1, 2, "book:section-a", "book:section-b"), false);
  assert.equal(shouldApplySectionNotesRequest(2, 2, "book:section-a", "book:section-b"), false);
});

test("chapter notes stale responses cannot finish a newer loading request or update after unmount", () => {
  assert.equal(shouldApplySectionNotesRequest(1, 2, "book:section-a", "book:section-b"), false);
  assert.equal(shouldApplySectionNotesRequest(2, 2, "book:section-b", "book:section-b", false), false);
});

test("keeps repeated non-contiguous chapters separate and falls back for untitled TXT pages", () => {
  const pages = [
    { id: "first", orderIndex: 0, title: "Chapter 1", chapterTitle: "Chapter 1" },
    { id: "first-middle", orderIndex: 1, title: "", chapterTitle: "Chapter 1" },
    { id: "second", orderIndex: 2, title: "Chapter 2", chapterTitle: "Chapter 2" },
    { id: "second-middle", orderIndex: 3, title: "", chapterTitle: "Chapter 2" },
    { id: "repeated", orderIndex: 4, title: "Chapter 1", chapterTitle: "Chapter 1" },
  ];
  assert.deepEqual(getStableChapterBoundary(pages, "repeated"), {
    key: "repeated",
    pages: [pages[4]],
  });
  assert.deepEqual(getStableChapterBoundary([{ id: "txt-page", orderIndex: 0, title: "", chapterTitle: null }], "txt-page"), {
    key: "section:txt-page",
    pages: [{ id: "txt-page", orderIndex: 0, title: "", chapterTitle: null }],
  });
});
