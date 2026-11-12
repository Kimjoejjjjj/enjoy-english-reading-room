import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { AiProviderError, getAiProviderConfig, listAiProviderModels, resolveAiProviderConfig } from "@/lib/ai-provider";
import { AiConnectionValidationError, getAiProviderLabel, resolveAiConnection } from "@/lib/ai-providers";

export const runtime = "nodejs";

/**
 * 用用户提供的 Key（仅本次请求使用，不保存）或已保存的凭据查询可用模型。
 * 目的是让设置页可以直接选择模型，而不是凭记忆填写模型名或接入点 ID。
 */
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { apiKey?: unknown; provider?: unknown; baseUrl?: unknown } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  let config;
  if (apiKey) {
    try {
      const site = getAiProviderConfig();
      const connection = resolveAiConnection({ provider: body?.provider ?? site.provider, baseUrl: body?.baseUrl, model: "connection-test" }, site);
      config = { configured: true, apiKey, ...connection };
    } catch (error) {
      if (error instanceof AiConnectionValidationError) return NextResponse.json({ error: error.message, code: "INVALID_CONNECTION" }, { status: 400 });
      throw error;
    }
  } else {
    const resolved = await resolveAiProviderConfig(userId);
    if (!resolved.config.configured || !resolved.config.apiKey) return NextResponse.json({ error: "请先填写 API Key，或先保存一个可用的 Key。", code: "KEY_REQUIRED" }, { status: 400 });
    config = resolved.config;
  }

  try {
    const result = await listAiProviderModels(config);
    return NextResponse.json({ ...result, provider: config.provider });
  } catch (error) {
    if (!(error instanceof AiProviderError)) return NextResponse.json({ error: "查询模型列表失败。", code: "PROVIDER_ERROR" }, { status: 502 });
    const label = getAiProviderLabel(config.provider);
    const messages: Record<string, string> = {
      INVALID_KEY: `${label} Key 无效或没有访问权限。`,
      TIMEOUT: `${label} 连接超时，请稍后重试。`,
      NETWORK: `服务器无法连接 ${label}，请检查网络。`,
      PROVIDER_ERROR: `${label} 暂时无法返回模型列表。`,
    };
    return NextResponse.json({ error: messages[error.code] || messages.PROVIDER_ERROR, code: error.code, detail: error.detail || null }, { status: 502 });
  }
}
