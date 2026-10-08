export function restoreDeletedHighlight<T extends { id: string; createdAt: string }>(items: T[], deleted: T) {
  if (items.some((item) => item.id === deleted.id)) return items;
  return [...items, deleted].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
