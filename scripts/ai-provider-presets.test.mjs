import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import {
  decryptAiCredential,
  encryptAiApiKey,
  encryptAiCredential,
} from "../src/lib/ai-credential.ts";
import {
  AI_PROVIDER_PRESETS,
  AiConnectionValidationError,
  describeAiNetworkCause,
  getAiProviderPreset,
  parseAiModelList,
  resolveAiConnection,
  resolveResponseTokenBudget,
  resolveTruncatedRetryBudget,
  supportsThinkingToggle,
} from "../src/lib/ai-providers.ts";

const originalKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
const originalPrivate = process.env.AI_ALLOW_PRIVATE_BASE_URL;
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
delete process.env.AI_ALLOW_PRIVATE_BASE_URL;

after(() => {
  if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  if (originalPrivate === undefined) delete process.env.AI_ALLOW_PRIVATE_BASE_URL;
  else process.env.AI_ALLOW_PRIVATE_BASE_URL = originalPrivate;
});

const volcengineConnection = {
  provider: "volcengine",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "ep-test-endpoint",
};

test("v2 credentials keep provider, base URL and model without plaintext", () => {
  const apiKey = "synthetic-volcengine-key-not-a-secret";
  const encrypted = encryptAiCredential("user-a", { ...volcengineConnection, apiKey });
  assert.equal(encrypted.formatVersion, "v2");
  assert.equal(encrypted.keyLast4, apiKey.slice(-4));
  assert.equal(encrypted.encryptedApiKey.includes(apiKey), false);
  assert.equal(encrypted.encryptedApiKey.includes(volcengineConnection.baseUrl), false);
  const decrypted = decryptAiCredential({ userId: "user-a", provider: "volcengine", ...encrypted });
  assert.deepEqual(decrypted, { ...volcengineConnection, apiKey });
});

test("legacy v1 DeepSeek records still decrypt and fall back to server defaults", () => {
  const apiKey = "synthetic-legacy-key-not-a-secret";
  const encrypted = encryptAiApiKey("user-a", apiKey);
  const decrypted = decryptAiCredential({ userId: "user-a", provider: "deepseek", ...encrypted });
  assert.deepEqual(decrypted, { provider: "deepseek", apiKey, baseUrl: null, model: null });
});

test("v2 credentials are bound to user and provider", () => {
  const encrypted = encryptAiCredential("user-a", { ...volcengineConnection, apiKey: "synthetic-volcengine-key-not-a-secret" });
  const stored = { userId: "user-a", provider: "volcengine", ...encrypted };
  assert.throws(() => decryptAiCredential({ ...stored, userId: "user-b" }));
  assert.throws(() => decryptAiCredential({ ...stored, provider: "deepseek" }));
  assert.throws(() => decryptAiCredential({ ...stored, formatVersion: "v3" }));
});

test("volcengine resolves to the Ark OpenAI-compatible endpoint", () => {
  const resolved = resolveAiConnection({ provider: "volcengine", baseUrl: "", model: "ep-test-endpoint" });
  assert.deepEqual(resolved, volcengineConnection);
  assert.equal(supportsThinkingToggle("volcengine"), false);
  assert.equal(supportsThinkingToggle("deepseek"), true);
});

test("preset base URLs cannot be redirected to another host", () => {
  assert.throws(
    () => resolveAiConnection({ provider: "deepseek", baseUrl: "https://attacker.example.com/v1", model: "deepseek-chat" }),
    AiConnectionValidationError,
  );
});

test("custom providers require a public HTTPS base URL", () => {
  const resolved = resolveAiConnection({ provider: "custom", baseUrl: "https://api.example.com/v1/", model: "vendor/model-1" });
  assert.deepEqual(resolved, { provider: "custom", baseUrl: "https://api.example.com/v1", model: "vendor/model-1" });
  for (const baseUrl of ["http://api.example.com/v1", "http://localhost:11434/v1", "https://127.0.0.1/v1", "https://192.168.1.10/v1", "https://10.0.0.8/v1", "not-a-url"]) {
    assert.throws(() => resolveAiConnection({ provider: "custom", baseUrl, model: "model" }), AiConnectionValidationError, baseUrl);
  }
});

test("private base URLs can be enabled explicitly for self-hosted models", () => {
  process.env.AI_ALLOW_PRIVATE_BASE_URL = "true";
  const resolved = resolveAiConnection({ provider: "custom", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" });
  assert.equal(resolved.baseUrl, "http://localhost:11434/v1");
  delete process.env.AI_ALLOW_PRIVATE_BASE_URL;
});

test("model names are required and restricted to safe characters", () => {  assert.throws(() => resolveAiConnection({ provider: "volcengine", baseUrl: "", model: "" }), AiConnectionValidationError);
  assert.throws(() => resolveAiConnection({ provider: "volcengine", baseUrl: "", model: "bad model name" }), AiConnectionValidationError);
  assert.equal(getAiProviderPreset("unknown-provider").id, "deepseek");
});

test("model list parsing keeps unique ids and rejects malformed payloads", () => {
  assert.deepEqual(parseAiModelList({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "a-model" }, { id: "" }, { id: 123 }, null] }), ["a-model", "b-model"]);
  assert.deepEqual(parseAiModelList({ data: {} }), []);
  assert.deepEqual(parseAiModelList(null), []);
  assert.equal(parseAiModelList({ data: Array.from({ length: 150 }, (_, index) => ({ id: `m${index}` })) }).length, 100);
});

test("network failures surface the underlying cause instead of a generic message", () => {
  const cause = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
  const error = Object.assign(new TypeError("fetch failed"), { cause });
  assert.equal(describeAiNetworkCause(error), "fetch failed: ECONNRESET");
  assert.equal(describeAiNetworkCause(new Error("certificate expired")), "certificate expired");
  assert.equal(describeAiNetworkCause(null), "");
  const cyclic = { message: "socket closed" };
  cyclic.cause = cyclic;
  assert.equal(describeAiNetworkCause(cyclic), "socket closed");
});

test("every preset offers either starter models or a manual entry path", () => {
  for (const preset of AI_PROVIDER_PRESETS) {
    assert.ok(Array.isArray(preset.models), preset.id);
    for (const model of preset.models) assert.match(model, /^[A-Za-z0-9._:/-]+$/, `${preset.id}: ${model}`);
  }
  assert.ok(getAiProviderPreset("volcengine-coding").models.length > 0);
});

test("volcengine Coding Plan uses its own OpenAI-compatible base URL", () => {
  const coding = resolveAiConnection({ provider: "volcengine-coding", model: "deepseek-v4.1-flash" });
  assert.equal(coding.baseUrl, "https://ark.cn-beijing.volces.com/api/coding/v3");
  assert.notEqual(coding.baseUrl, getAiProviderPreset("volcengine").baseUrl);
  assert.ok(getAiProviderPreset("volcengine-coding").models.includes("deepseek-v4.1-flash"));
  // 按量调用不再预置猜测的模型 ID，避免用户选中一个账号里并不存在的模型。
  assert.deepEqual(getAiProviderPreset("volcengine").models, []);
});

test("response budgets leave room for structured output and cap truncated retries", () => {
  assert.equal(resolveResponseTokenBudget("TEST"), 32);
  assert.equal(resolveResponseTokenBudget("EXPLAIN"), 1024);
  assert.equal(resolveResponseTokenBudget("CONTEXT"), 1024);
  assert.equal(resolveResponseTokenBudget("GRAMMAR"), 1200);
  assert.equal(resolveResponseTokenBudget("DICTIONARY_TRANSLATION"), 1200);
  assert.equal(resolveResponseTokenBudget("UNKNOWN"), 1200);
  assert.equal(resolveTruncatedRetryBudget(1024), 2048);
  assert.equal(resolveTruncatedRetryBudget(2048), 3072);
  assert.equal(resolveTruncatedRetryBudget(3072), 3072);
  assert.equal(resolveTruncatedRetryBudget(0), 3072);
  assert.equal(resolveTruncatedRetryBudget(Number.NaN), 3072);
});

test("key-only submissions keep the site model so cache identity stays stable", () => {
  const site = { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" };
  const legacy = resolveAiConnection({}, site);
  assert.deepEqual(legacy, site);
  const explicitOtherProvider = resolveAiConnection({ provider: "volcengine", model: "ep-test-endpoint" }, site);
  assert.equal(explicitOtherProvider.baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(explicitOtherProvider.model, "ep-test-endpoint");
});
