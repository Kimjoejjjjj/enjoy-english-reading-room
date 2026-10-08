import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT_VERSION = "v1";
const PROVIDER = "deepseek";

export interface EncryptedAiCredential {
  encryptedApiKey: string;
  encryptionIv: string;
  authTag: string;
  keyLast4: string;
  formatVersion: typeof FORMAT_VERSION;
}

interface StoredAiCredential {
  userId: string;
  provider: string;
  encryptedApiKey: string;
  encryptionIv: string;
  authTag: string;
  formatVersion: string;
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

function additionalData(userId: string, provider = PROVIDER, version = FORMAT_VERSION) {
  return Buffer.from(`${version}|${provider}|${userId}`, "utf8");
}

export function isAiCredentialEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptAiApiKey(userId: string, apiKey: string): EncryptedAiCredential {
  const value = apiKey.trim();
  if (value.length < 8 || value.length > 512) throw new Error("Invalid API key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(additionalData(userId));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encryptedApiKey: encrypted.toString("base64"),
    encryptionIv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyLast4: value.slice(-4),
    formatVersion: FORMAT_VERSION,
  };
}

export function decryptAiApiKey(credential: StoredAiCredential) {
  if (credential.provider !== PROVIDER || credential.formatVersion !== FORMAT_VERSION) throw new AiCredentialEncryptionError("Unsupported AI credential format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(credential.encryptionIv, "base64"));
    decipher.setAAD(additionalData(credential.userId, credential.provider, credential.formatVersion));
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(credential.encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof AiCredentialEncryptionError) throw error;
    throw new AiCredentialEncryptionError("Stored AI credential cannot be decrypted");
  }
}
