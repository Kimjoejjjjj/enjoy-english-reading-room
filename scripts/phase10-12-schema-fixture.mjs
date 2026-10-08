import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [databasePath, generatedClientPath] = process.argv.slice(2);
if (!databasePath || !generatedClientPath) throw new Error("Expected isolated database and generated client paths");
const clientModule = await import(pathToFileURL(resolve(generatedClientPath, "index.js")).href);
const PrismaClient = clientModule.PrismaClient || clientModule.default?.PrismaClient;
const prisma = new PrismaClient({ datasources: { db: { url: `file:${resolve(databasePath).replaceAll("\\", "/")}` } } });
const suffix = randomUUID();

try {
  const user = await prisma.user.create({ data: { email: `phase10-12-${suffix}@example.invalid` } });
  const content = await prisma.content.create({ data: { userId: user.id, title: "Fixture", format: "TXT", source: "PASTE", status: "READY", fileUrl: `fixture://${suffix}` } });
  const section = await prisma.contentSection.create({ data: { contentId: content.id, orderIndex: 0, title: "Fixture", plainText: "Fixture text" } });
  const session = await prisma.readingSession.create({ data: { userId: user.id, contentId: content.id, currentSectionId: section.id } });

  const requestId = randomUUID();
  const event = await prisma.learningEvent.create({ data: { userId: user.id, contentId: content.id, sectionId: section.id, sessionId: session.id, eventType: "HIGHLIGHT_CREATED", requestId, operationType: "HIGHLIGHT_CREATE", bindingHash: "fixture-binding", resultEntityId: "fixture-result" } });
  assert.equal((await prisma.learningEvent.findUnique({ where: { requestId } }))?.id, event.id);

  const idempotencyKey = randomUUID();
  const operation = await prisma.importOperation.create({ data: { idempotencyKey, userId: user.id, bindingHash: "import-binding", previewFingerprint: "preview", title: "Pasted fixture", contentHash: "hash", status: "COMPLETED", contentId: content.id, resultJson: JSON.stringify({ contentId: content.id }) } });
  assert.equal((await prisma.importOperation.findUnique({ where: { idempotencyKey } }))?.id, operation.id);

  const batchId = randomUUID();
  const batch = await prisma.reparseBatch.create({ data: { batchId, userId: user.id, contentId: content.id, contentFingerprint: "content-fingerprint", protectedFingerprint: "protected-fingerprint", resultJson: JSON.stringify({ sectionCount: 1 }) } });
  assert.equal((await prisma.reparseBatch.findUnique({ where: { batchId } }))?.id, batch.id);
  console.log(JSON.stringify({ eventReplay: true, importReplay: true, reparseReplay: true }));
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.importOperation.count(), 0);
  assert.equal(await prisma.reparseBatch.count(), 0);
} finally {
  await prisma.$disconnect();
}
