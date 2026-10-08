import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// SQLite obtains its writer reservation before any authoritative reads.
// The no-op statement does not change user data or updatedAt.
export function readingWrite<T>(userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 15_000): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE users SET id = id WHERE id = ${userId}`;
    return work(tx);
  }, { timeout, maxWait: 10_000 });
}

export async function validReadingSource(tx: Prisma.TransactionClient, userId: string, contentId: string, sectionId?: string | null, segmentId?: string | null) {
  const content = await tx.content.findUnique({ where: { id: contentId }, select: { userId: true } });
  if (!content || content.userId && content.userId !== userId) return false;
  if (sectionId && !await tx.contentSection.findFirst({ where: { id: sectionId, contentId }, select: { id: true } })) return false;
  if (segmentId && (!sectionId || !await tx.contentSegment.findFirst({ where: { id: segmentId, sectionId, section: { contentId } }, select: { id: true } }))) return false;
  return true;
}
