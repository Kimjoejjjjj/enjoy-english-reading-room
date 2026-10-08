import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("Expected an isolated database path");
const expected = resolve(databasePath);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${expected.replaceAll("\\", "/")}` } } });

try {
  const databases = await prisma.$queryRawUnsafe("PRAGMA database_list");
  const actual = resolve(String(databases.find((item) => item.name === "main")?.file || ""));
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Database target mismatch: ${actual}`);
  const counts = await prisma.$queryRawUnsafe(`
    SELECT 'LearningEvent' AS name, COUNT(*) AS count FROM LearningEvent
    UNION ALL SELECT 'SectionProgress', COUNT(*) FROM SectionProgress
    UNION ALL SELECT 'Highlight', COUNT(*) FROM Highlight
    UNION ALL SELECT 'UserVocabulary', COUNT(*) FROM UserVocabulary
    UNION ALL SELECT 'VocabularyOccurrence', COUNT(*) FROM VocabularyOccurrence
  `);
  const foreignKeys = await prisma.$queryRawUnsafe("PRAGMA foreign_key_check");
  console.log(JSON.stringify({ database: actual, counts, foreignKeyViolations: foreignKeys.length }, (_, value) => typeof value === "bigint" ? value.toString() : value));
} finally {
  await prisma.$disconnect();
}
