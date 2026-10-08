import { prisma } from "@/lib/db";

export async function getAccessibleContent(contentId: string, userId: string) {
  const content = await prisma.content.findUnique({ where: { id: contentId } });
  if (!content || (content.userId && content.userId !== userId)) return null;
  return content;
}

export function serializeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
