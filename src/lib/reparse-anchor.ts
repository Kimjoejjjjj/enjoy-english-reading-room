export interface AnchorPosition { start: number; end: number }
function normalizedOffsets(text: string) {
  let normalized = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (/\s/.test(char)) {
      if (normalized && !normalized.endsWith(" ")) { normalized += " "; offsets.push(index); }
    } else { normalized += char; offsets.push(index); }
  }
  if (normalized.endsWith(" ")) { normalized = normalized.slice(0, -1); offsets.pop(); }
  return { normalized, offsets };
}
export function anchorPositions(text: string, target: string): AnchorPosition[] {
  const { normalized, offsets } = normalizedOffsets(text);
  const anchor = normalizedOffsets(target).normalized;
  if (!anchor) return [];
  const positions: AnchorPosition[] = [];
  let cursor = 0;
  while (cursor <= normalized.length - anchor.length) {
    const start = normalized.indexOf(anchor, cursor);
    if (start < 0) break;
    positions.push({ start: offsets[start], end: offsets[start + anchor.length - 1] + 1 });
    cursor = start + 1;
  }
  return positions;
}
