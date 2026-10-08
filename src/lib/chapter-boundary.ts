export interface ChapterBoundaryPage {
  id: string;
  orderIndex: number;
  title: string;
  chapterTitle?: string | null;
}

export interface StableChapterBoundary {
  /** The first persisted section id in this contiguous chapter run. */
  key: string;
  pages: ChapterBoundaryPage[];
}

/**
 * Finds the contiguous chapter run containing a section.
 *
 * The persisted first-section id is used as the boundary key.  This avoids
 * merging non-contiguous chapters that happen to share a title, while still
 * allowing old rows without a chapter title to fall back conservatively to a
 * single section.
 */
export function getStableChapterBoundary(
  pages: ChapterBoundaryPage[],
  currentSectionId: string,
): StableChapterBoundary {
  const currentIndex = pages.findIndex((page) => page.id === currentSectionId);
  if (currentIndex < 0) {
    return { key: `section:${currentSectionId}`, pages: [] };
  }

  const current = pages[currentIndex];
  const chapterTitle = current.chapterTitle?.trim();
  if (!chapterTitle) {
    return { key: `section:${current.id}`, pages: [current] };
  }

  let start = currentIndex;
  while (start > 0 && pages[start - 1].chapterTitle?.trim() === chapterTitle) {
    start -= 1;
  }

  let end = currentIndex;
  while (end + 1 < pages.length && pages[end + 1].chapterTitle?.trim() === chapterTitle) {
    end += 1;
  }

  return {
    key: pages[start].id,
    pages: pages.slice(start, end + 1),
  };
}
