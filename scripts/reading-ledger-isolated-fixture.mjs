import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { nextLeaseExpiry, READING_HEARTBEAT_SECONDS, validateLiveDelta } from "../src/lib/reading-ledger-contract.ts";

const [databasePath, generatedClientPath] = process.argv.slice(2);
if (!databasePath || !generatedClientPath) throw new Error("Expected isolated database and generated client paths");
const clientModule = await import(pathToFileURL(resolve(generatedClientPath, "index.js")).href);
const PrismaClient = clientModule.PrismaClient || clientModule.default?.PrismaClient;
const prisma = new PrismaClient({ datasources: { db: { url: `file:${resolve(databasePath).replaceAll("\\", "/")}` } } });
const fixtureId = randomUUID();

try {
  const user = await prisma.user.create({ data: { email: `phase9-${fixtureId}@example.invalid`, name: "Phase 9 fixture" } });
  const content = await prisma.content.create({ data: { userId: user.id, title: "Phase 9 fixture", format: "TXT", status: "READY", fileUrl: `fixture://${fixtureId}` } });
  const section = await prisma.contentSection.create({ data: { contentId: content.id, orderIndex: 0, title: "Fixture", plainText: "A fixture section." } });
  const session = await prisma.readingSession.create({ data: { userId: user.id, contentId: content.id, currentSectionId: section.id } });
  const now = new Date();
  const ownerToken = randomUUID();
  let lease = await prisma.readingLease.create({ data: { userId: user.id, sessionId: session.id, ownerToken, fencingVersion: 1, leaseExpiresAt: nextLeaseExpiry(now), heartbeatIntervalSeconds: READING_HEARTBEAT_SECONDS } });
  const deltaId = randomUUID();
  const input = { deltaId, userId: user.id, sessionId: session.id, contentId: content.id, sectionId: section.id, ownerToken, fencingVersion: 1, seconds: 15 };
  assert.equal(validateLiveDelta(input, lease, now), null);
  const first = await prisma.readingTimeDelta.create({ data: { ...input, kind: "LIVE" } });
  const replay = await prisma.readingTimeDelta.findUnique({ where: { deltaId } });
  assert.equal(replay?.id, first.id);

  const nextOwnerToken = randomUUID();
  lease = await prisma.readingLease.update({ where: { userId: user.id }, data: { sessionId: session.id, ownerToken: nextOwnerToken, fencingVersion: { increment: 1 }, leaseExpiresAt: nextLeaseExpiry(now) } });
  assert.equal(validateLiveDelta(input, lease, now), "STALE_OWNER");
  const nextInput = { ...input, deltaId: randomUUID(), ownerToken: nextOwnerToken, fencingVersion: lease.fencingVersion, seconds: 20 };
  assert.equal(validateLiveDelta(nextInput, lease, now), null);
  await prisma.readingTimeDelta.create({ data: { ...nextInput, kind: "LIVE" } });
  await prisma.readingTimeDelta.create({ data: { deltaId: randomUUID(), userId: user.id, kind: "OPENING_BALANCE", seconds: 120, sourceKey: "fixture-baseline" } });

  const live = await prisma.readingTimeDelta.aggregate({ where: { userId: user.id, kind: "LIVE" }, _sum: { seconds: true }, _count: true });
  const lifetime = await prisma.readingTimeDelta.aggregate({ where: { userId: user.id }, _sum: { seconds: true } });
  assert.deepEqual({ count: live._count, seconds: live._sum.seconds, lifetime: lifetime._sum.seconds }, { count: 2, seconds: 35, lifetime: 155 });
  console.log(JSON.stringify({ replay: true, staleOwnerRejected: true, liveCount: live._count, liveSeconds: live._sum.seconds, lifetimeSeconds: lifetime._sum.seconds }));
  await prisma.user.delete({ where: { id: user.id } });
} finally {
  await prisma.$disconnect();
}
