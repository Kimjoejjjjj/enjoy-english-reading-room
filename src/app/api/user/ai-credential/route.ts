import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptAiCredential, encryptAiCredential, isAiCredentialEncryptionConfigured } from "@/lib/ai-credential";
import { AiProviderError, callAiProvider, getAiProviderConfig } from "@/lib/ai-provider";
import { AiConnectionValidationError, DEFAULT_AI_MODEL, getAiProviderLabel, getAiProviderPreset, resolveAiConnection } from "@/lib/ai-providers";

export const runtime = "nodejs";

function providerError(error: AiProviderError, provider: string) {
  const label = getAiProviderLabel(provider);
  const accessHint = error.detail?.includes("InvalidEndpointOrModel.NotFound")
    ? "该模型或接入点在你的账号下不可用：请确认是否选错了接入方式（火山方舟 Coding Plan 与普通按量调用是不同地址），或改为手动输入推理接入点 ID。"
    : "";
  const messages: Record<AiProviderError["code"], string> = {
    INVALID_KEY: `${label} Key 无效或没有访问权限。`,
    INVALID_MODEL: `${label} 返回模型或 API 地址不可用，请检查模型名是否填写正确。${accessHint}`,
    BALANCE_OR_RATE_LIMIT: `${label} 账户余额不足、请求过快或受到服务限制。`,
    TIMEOUT: `${label} 连接超时，请稍后重试。`,
    NETWORK: `服务器无法连接 ${label}，请检查网络。`,
    EMPTY_RESPONSE: `${label} 已连接，但没有返回有效内容。`,
    TRUNCATED: `${label} 返回内容不完整，请重试。`,
    INVALID_FORMAT: `${label} 返回格式无效，请重试。`,
    PROVIDER_ERROR: `${label} 服务暂时不可用。`,
  };
  const status = error.code === "INVALID_KEY" ? 400 : error.code === "BALANCE_OR_RATE_LIMIT" ? 402 : 502;
  return NextResponse.json({ error: messages[error.code], code: error.code, status: error.status, detail: error.detail || null }, { status });
}

function defaultCredentialStatus() {
  const site = getAiProviderConfig();
  return { provider: site.provider, baseUrl: site.baseUrl, model: site.model, keyLast4: null, updatedAt: null };
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credential = await prisma.userAiCredential.findUnique({ where: { userId } });
  const base = { encryptionConfigured: isAiCredentialEncryptionConfigured() };
  if (!credential) return NextResponse.json({ configured: false, ...base, ...defaultCredentialStatus() });
  try {
    const decrypted = decryptAiCredential(credential);
    const preset = getAiProviderPreset(decrypted.provider);
    const site = getAiProviderConfig();
    return NextResponse.json({
      configured: true,
      ...base,
      provider: decrypted.provider,
      baseUrl: decrypted.baseUrl || preset.baseUrl,
      model: decrypted.model || (decrypted.provider === site.provider ? site.model : decrypted.provider === "deepseek" ? DEFAULT_AI_MODEL : ""),
      keyLast4: credential.keyLast4,
      updatedAt: credential.updatedAt,
    });
  } catch {
    // 解密密钥变更或数据损坏时，仍让页面显示"已保存但不可用"，并允许用户重新保存。
    return NextResponse.json({ configured: true, readable: false, ...base, ...defaultCredentialStatus(), updatedAt: credential.updatedAt });
  }
}

export async function PUT(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAiCredentialEncryptionConfigured()) return NextResponse.json({ error: "服务器尚未配置 API Key 加密功能。", code: "ENCRYPTION_NOT_CONFIGURED" }, { status: 503 });
  const body = await req.json().catch(() => null) as { apiKey?: unknown; provider?: unknown; baseUrl?: unknown; model?: unknown } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 512) return NextResponse.json({ error: "请输入有效的 API Key。" }, { status: 400 });

  let connection;
  try {
    const site = getAiProviderConfig();
    connection = resolveAiConnection({ provider: body?.provider ?? site.provider, baseUrl: body?.baseUrl, model: body?.model }, site);
  } catch (error) {
    if (error instanceof AiConnectionValidationError) return NextResponse.json({ error: error.message, code: "INVALID_CONNECTION" }, { status: 400 });
    throw error;
  }

  const config = { configured: true, apiKey, ...connection };
  try {
    const result = await callAiProvider({ requestType: "TEST", text: "connection test" }, config);
    if (!result) throw new AiProviderError("PROVIDER_ERROR");
    const encrypted = encryptAiCredential(userId, { ...connection, apiKey });
    const credential = await prisma.userAiCredential.upsert({
      where: { userId },
      create: { userId, provider: connection.provider, ...encrypted },
      update: { provider: connection.provider, ...encrypted },
      select: { provider: true, keyLast4: true, updatedAt: true },
    });
    return NextResponse.json({
      configured: true,
      encryptionConfigured: true,
      ...credential,
      baseUrl: connection.baseUrl,
      model: result.model || connection.model,
    });
  } catch (error) {
    if (error instanceof AiProviderError) return providerError(error, connection.provider);
    return NextResponse.json({ error: "无法安全保存 API Key。", code: "CREDENTIAL_SAVE_FAILED" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.userAiCredential.deleteMany({ where: { userId } });
  return NextResponse.json({ configured: false, encryptionConfigured: isAiCredentialEncryptionConfigured(), ...defaultCredentialStatus() });
}
