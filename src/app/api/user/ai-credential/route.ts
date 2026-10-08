import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptAiApiKey, isAiCredentialEncryptionConfigured } from "@/lib/ai-credential";
import { AiProviderError, callAiProvider, getAiProviderConfig } from "@/lib/ai-provider";

export const runtime = "nodejs";

function providerError(error: AiProviderError) {
  const messages: Record<AiProviderError["code"], string> = {
    INVALID_KEY: "DeepSeek Key 无效或没有访问权限。",
    INVALID_MODEL: "当前 DeepSeek 模型或 API 地址不可用。",
    BALANCE_OR_RATE_LIMIT: "DeepSeek 账户余额不足、请求过快或受到服务限制。",
    TIMEOUT: "DeepSeek 连接超时，请稍后重试。",
    NETWORK: "服务器无法连接 DeepSeek，请检查网络。",
    EMPTY_RESPONSE: "DeepSeek 已连接，但没有返回有效内容。",
    TRUNCATED: "DeepSeek 返回内容不完整，请重试。",
    INVALID_FORMAT: "DeepSeek 返回格式无效，请重试。",
    PROVIDER_ERROR: "DeepSeek 服务暂时不可用。",
  };
  const status = error.code === "INVALID_KEY" ? 400 : error.code === "BALANCE_OR_RATE_LIMIT" ? 402 : 502;
  return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credential = await prisma.userAiCredential.findUnique({ where: { userId }, select: { provider: true, keyLast4: true, updatedAt: true } });
  return NextResponse.json({
    configured: Boolean(credential),
    encryptionConfigured: isAiCredentialEncryptionConfigured(),
    provider: credential?.provider || "deepseek",
    keyLast4: credential?.keyLast4 || null,
    updatedAt: credential?.updatedAt || null,
  });
}

export async function PUT(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAiCredentialEncryptionConfigured()) return NextResponse.json({ error: "服务器尚未配置 API Key 加密功能。", code: "ENCRYPTION_NOT_CONFIGURED" }, { status: 503 });
  const body = await req.json().catch(() => null) as { apiKey?: unknown } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 512) return NextResponse.json({ error: "请输入有效的 DeepSeek API Key。" }, { status: 400 });

  const site = getAiProviderConfig();
  const config = { ...site, configured: true, apiKey, provider: "deepseek" };
  try {
    const result = await callAiProvider({ requestType: "TEST", text: "connection test" }, config);
    if (!result) throw new AiProviderError("PROVIDER_ERROR");
    const encrypted = encryptAiApiKey(userId, apiKey);
    const credential = await prisma.userAiCredential.upsert({
      where: { userId },
      create: { userId, provider: "deepseek", ...encrypted },
      update: { provider: "deepseek", ...encrypted },
      select: { provider: true, keyLast4: true, updatedAt: true },
    });
    return NextResponse.json({ configured: true, encryptionConfigured: true, ...credential, model: result.model || config.model });
  } catch (error) {
    if (error instanceof AiProviderError) return providerError(error);
    return NextResponse.json({ error: "无法安全保存 DeepSeek Key。", code: "CREDENTIAL_SAVE_FAILED" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.userAiCredential.deleteMany({ where: { userId } });
  return NextResponse.json({ configured: false, encryptionConfigured: isAiCredentialEncryptionConfigured(), provider: "deepseek", keyLast4: null, updatedAt: null });
}
