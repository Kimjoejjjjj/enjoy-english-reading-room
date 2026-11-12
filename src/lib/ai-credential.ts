import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 本模块被 node --test 直接加载，保持零项目内依赖（不要使用 @/ 别名）。

const LEGACY_FORMAT_VERSION = "v1";
const FORMAT_VERSION = "v2";
const LEGACY_PROVIDER = "deepseek";

export interface EncryptedAiCredential {
  encryptedApiKey: string;
  encryptionIv: string;
  authTag: string;
  keyLast4: string;
  formatVersion: string;
}

interface StoredAiCredential {
  userId: string;
  provider: string;
  encryptedApiKey: string;
  encryptionIv: string;
  authTag: string;
  formatVersion: string;
}

export interface AiCredentialInput {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DecryptedAiCredential {
  provider: string;
  apiKey: string;
  /** v1 记录没有保存地址和模型，返回 null，由调用方回退到服务器环境变量。 */
  baseUrl: string | null;
  model: string | null;
}

export class AiCredentialEncryptionError extends Error {
  constructor(message = "AI credential encryption is unavailable") {
    super(message);
    this.name = "AiCredentialEncryptionError";
  }
}

function encryptionKey(raw = process.env.AI_CREDENTIAL_ENCRYPTION_KEY) {
  if (!raw) throw new AiCredentialEncryptionError();
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new AiCredentialEncryptionError();
  }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.trim().replace(/=+$/, "")) throw new AiCredentialEncryptionError();
  return key;
}

function additionalData(userId: string, provider: string, version: string) {
  return Buffer.from(`${version}|${provider}|${userId}`, "utf8");
}

function assertApiKey(value: string) {
  const apiKey = value.trim();
  if (apiKey.length < 8 || apiKey.length > 512) throw new Error("Invalid API key");
  return apiKey;
}

export function isAiCredentialEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function encrypt(userId: string, provider: string, version: string, payload: string, keyLast4: string): EncryptedAiCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(additionalData(userId, provider, version));
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return {
    encryptedApiKey: encrypted.toString("base64"),
    encryptionIv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyLast4,
    formatVersion: version,
  };
}

function normalizeProviderId(value: unknown) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return id || LEGACY_PROVIDER;
}

/**
 * v2 把服务商、API 地址和模型与 Key 一起加密保存，因此不需要修改数据库结构。
 * 地址和模型不是机密，放在密文里只是为了复用现有字段与防篡改的 AAD。
 */
export function encryptAiCredential(userId: string, input: AiCredentialInput): EncryptedAiCredential {
  const provider = normalizeProviderId(input.provider);
  const apiKey = assertApiKey(input.apiKey);
  const payload = JSON.stringify({ apiKey, baseUrl: input.baseUrl, model: input.model });
  return encrypt(userId, provider, FORMAT_VERSION, payload, apiKey.slice(-4));
}

/** 旧版 DeepSeek 专用格式，保留用于兼容已有数据与历史测试。新代码请使用 encryptAiCredential。 */
export function encryptAiApiKey(userId: string, apiKey: string): EncryptedAiCredential {
  const value = assertApiKey(apiKey);
  return encrypt(userId, LEGACY_PROVIDER, LEGACY_FORMAT_VERSION, value, value.slice(-4));
}

export function decryptAiCredential(credential: StoredAiCredential): DecryptedAiCredential {
  const version = credential.formatVersion;
  if (version !== LEGACY_FORMAT_VERSION && version !== FORMAT_VERSION) throw new AiCredentialEncryptionError("Unsupported AI credential format");
  if (version === LEGACY_FORMAT_VERSION && credential.provider !== LEGACY_PROVIDER) throw new AiCredentialEncryptionError("Unsupported AI credential format");
  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(credential.encryptionIv, "base64"));
    decipher.setAAD(additionalData(credential.userId, credential.provider, version));
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
    plaintext = Buffer.concat([decipher.update(Buffer.from(credential.encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof AiCredentialEncryptionError) throw error;
    throw new AiCredentialEncryptionError("Stored AI credential cannot be decrypted");
  }
  if (version === LEGACY_FORMAT_VERSION) {
    return { provider: LEGACY_PROVIDER, apiKey: plaintext, baseUrl: null, model: null };
  }
  try {
    const payload = JSON.parse(plaintext) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
    if (typeof payload.apiKey !== "string" || typeof payload.baseUrl !== "string" || typeof payload.model !== "string") throw new Error("invalid");
    return {
      provider: normalizeProviderId(credential.provider),
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      model: payload.model,
    };
  } catch {
    throw new AiCredentialEncryptionError("Stored AI credential payload is invalid");
  }
}

export function decryptAiApiKey(credential: StoredAiCredential) {
  return decryptAiCredential(credential).apiKey;
}
