import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import {
  AiCredentialEncryptionError,
  decryptAiApiKey,
  encryptAiApiKey,
  isAiCredentialEncryptionConfigured,
} from "../src/lib/ai-credential.ts";
import {
  dictionaryTranslationCacheHash,
  parseDictionaryAiTranslations,
} from "../src/lib/dictionary-ai.ts";

const originalKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");

after(() => {
  if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test("AES-256-GCM credentials round-trip with random IVs and no plaintext", () => {
  const apiKey = "synthetic-api-key-not-a-secret";
  const first = encryptAiApiKey("user-a", apiKey);
  const second = encryptAiApiKey("user-a", apiKey);
  assert.equal(isAiCredentialEncryptionConfigured(), true);
  assert.notEqual(first.encryptionIv, second.encryptionIv);
  assert.notEqual(first.encryptedApiKey, second.encryptedApiKey);
  assert.equal(first.encryptedApiKey.includes(apiKey), false);
  assert.equal(decryptAiApiKey({ userId: "user-a", provider: "deepseek", ...first }), apiKey);
});

test("tampering, wrong master key, and cross-user swaps cannot decrypt", () => {
  const encrypted = encryptAiApiKey("user-a", "synthetic-api-key-not-a-secret");
  const stored = { userId: "user-a", provider: "deepseek", ...encrypted };
  assert.throws(() => decryptAiApiKey({ ...stored, userId: "user-b" }), AiCredentialEncryptionError);
  assert.throws(() => decryptAiApiKey({ ...stored, encryptedApiKey: Buffer.from("tampered").toString("base64") }), AiCredentialEncryptionError);
  const validMaster = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  assert.throws(() => decryptAiApiKey(stored), AiCredentialEncryptionError);
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = validMaster;
});

test("missing or malformed master keys safely disable encrypted storage", () => {
  const validMaster = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  assert.equal(isAiCredentialEncryptionConfigured(), false);
  assert.throws(() => encryptAiApiKey("user-a", "synthetic-api-key-not-a-secret"), AiCredentialEncryptionError);
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "not-32-byte-base64";
  assert.equal(isAiCredentialEncryptionConfigured(), false);
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = validMaster;
});

const definitions = [
  { id: "throat-n-1", partOfSpeech: "noun", definition: "the passage to the stomach and lungs" },
  { id: "against-p-1", partOfSpeech: "preposition", definition: "in a contrary direction to" },
];

test("dictionary AI translations stay aligned to every requested sense", () => {
  const parsed = parseDictionaryAiTranslations(JSON.stringify({ translations: [
    { definitionId: "against-p-1", translation: "朝相反方向；逆着" },
    { definitionId: "throat-n-1", translation: "位于颈部、通向胃和肺的通道" },
  ] }), definitions);
  assert.deepEqual(parsed, [
    { definitionId: "throat-n-1", translation: "位于颈部、通向胃和肺的通道" },
    { definitionId: "against-p-1", translation: "朝相反方向；逆着" },
  ]);
  assert.equal(parseDictionaryAiTranslations('{"translations":[{"definitionId":"throat-n-1","translation":"喉咙"}]}', definitions), null);
  assert.equal(parseDictionaryAiTranslations('{"translations":[{"definitionId":"unknown","translation":"错误"},{"definitionId":"against-p-1","translation":"逆着"}]}', definitions), null);
});

test("dictionary cache identity covers definition content, model, lemma, and prompt version", () => {
  const base = dictionaryTranslationCacheHash("throat", definitions, "deepseek-chat");
  assert.notEqual(base, dictionaryTranslationCacheHash("against", definitions, "deepseek-chat"));
  assert.notEqual(base, dictionaryTranslationCacheHash("throat", definitions, "other-model"));
  assert.notEqual(base, dictionaryTranslationCacheHash("throat", [{ ...definitions[0], definition: "changed" }, definitions[1]], "deepseek-chat"));
});
