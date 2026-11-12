export interface AiProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  modelPlaceholder: string;
  /** 常见模型示例，仅供下拉选择，仍可手动输入；以服务商控制台为准。 */
  models: string[];
  docsUrl: string;
  /** 是否发送 DeepSeek 风格的 thinking 开关。其他厂商不认识该字段时会直接返回 400。 */
  supportsThinkingToggle: boolean;
  /** 为 true 时用户必须自己填写 API 地址。 */
  customBaseUrl: boolean;
}

export const DEFAULT_AI_PROVIDER = "deepseek";
export const DEFAULT_AI_MODEL = "deepseek-flash";

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelPlaceholder: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docsUrl: "https://api-docs.deepseek.com/",
    supportsThinkingToggle: true,
    customBaseUrl: false,
  },
  {
    id: "volcengine",
    label: "火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelPlaceholder: "推理接入点 ep-xxxxxxxx，或已开通的模型 ID",
    // 按量调用的模型 ID 需账号开通且带日期后缀，不预置猜测值；请用接入点 ID 或控制台复制的模型 ID。
    models: [],
    docsUrl: "https://www.volcengine.com/docs/82379",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    // Coding Plan 是独立接入方式：OpenAI 兼容工具走 /api/coding/v3，不是按量调用的 /api/v3。
    // 用错地址会返回 InvalidEndpointOrModel.NotFound，即使 Key 与模型名都正确。
    id: "volcengine-coding",
    label: "火山方舟 · Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelPlaceholder: "deepseek-v4.1-flash",
    // 模型清单来自官方文档与功能发布公告，以套餐页当前可用列表为准。
    models: ["deepseek-v4.1-flash", "doubao-seed-code-preview-latest", "ark-code-latest", "doubao-seed-2.1-pro", "doubao-seed-2.1-lite", "doubao-seed-2.0-mini"],
    docsUrl: "https://www.volcengine.com/docs/82379/1463945",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "qwen",
    label: "阿里百炼 · 通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelPlaceholder: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-flash", "qwen-max"],
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "moonshot",
    label: "Moonshot · Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    modelPlaceholder: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
    docsUrl: "https://platform.moonshot.cn/docs",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "zhipu",
    label: "智谱 · GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelPlaceholder: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus"],
    docsUrl: "https://docs.bigmodel.cn/",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelPlaceholder: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
    docsUrl: "https://platform.openai.com/docs/",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelPlaceholder: "deepseek/deepseek-chat",
    models: [],
    docsUrl: "https://openrouter.ai/docs",
    supportsThinkingToggle: false,
    customBaseUrl: false,
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容服务",
    baseUrl: "",
    modelPlaceholder: "模型名",
    models: [],
    docsUrl: "",
    supportsThinkingToggle: false,
    customBaseUrl: true,
  },
];

export interface AiConnectionInput {
  provider: string;
  baseUrl: string;
  model: string;
}

export class AiConnectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConnectionValidationError";
  }
}

export function getAiProviderPreset(value: unknown): AiProviderPreset {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) || AI_PROVIDER_PRESETS[0];
}

export function getAiProviderLabel(value: unknown): string {
  return getAiProviderPreset(value).label;
}

export function listAiProviderPresets() {
  return AI_PROVIDER_PRESETS.map(({ id, label, baseUrl, modelPlaceholder, models, docsUrl, customBaseUrl }) => ({ id, label, baseUrl, modelPlaceholder, models, docsUrl, customBaseUrl }));
}

/**
 * 提取网络异常的真实原因。Node/undici 把底层错误放在 cause 链上，
 * 只报"网络错误"会掩盖 ECONNRESET、ENOTFOUND、证书问题等关键线索。
 */
export function describeAiNetworkCause(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current) && parts.length < 2) {
    seen.add(current);
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.code === "string" && value.code) parts.push(value.code);
    else if (typeof value.message === "string" && value.message) parts.push(value.message);
    current = value.cause;
  }
  return parts.join(": ").slice(0, 200);
}

/** 解析 OpenAI 兼容的 GET /models 响应，只保留可用的模型 ID，去重并限制数量。 */
export function parseAiModelList(value: unknown, limit = 100): string[] {
  const data = value && typeof value === "object" ? (value as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    const id = item && typeof item === "object" ? (item as { id?: unknown }).id : null;
    if (typeof id !== "string") continue;
    const normalized = id.trim();
    if (!normalized || normalized.length > 120 || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
    if (ids.length === limit) break;
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function allowPrivateBaseUrl() {
  return process.env.AI_ALLOW_PRIVATE_BASE_URL === "true";
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^0\.0\.0\.0$/.test(host)) return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (host.includes(":")) return true;
  return false;
}

/**
 * 用户可以提供自定义 API 地址，服务器会代替用户向该地址发请求。
 * 默认只允许公网 HTTPS，避免把内网服务暴露给请求方；本地自托管模型可设置
 * AI_ALLOW_PRIVATE_BASE_URL=true 放开（仅限可信的本地部署）。
 */
export function normalizeAiBaseUrl(value: unknown, preset: AiProviderPreset, siteBaseUrl?: string): string {
  const raw = (typeof value === "string" ? value.trim() : "") || preset.baseUrl;
  if (!raw) throw new AiConnectionValidationError("请填写 API 地址。");
  if (raw.length > 200) throw new AiConnectionValidationError("API 地址过长。");
  // 固定服务商不允许改地址；与服务器环境变量一致的地址除外（站点配置属于管理员可信输入）。
  const siteMatched = siteBaseUrl && raw.replace(/\/+$/, "") === siteBaseUrl.replace(/\/+$/, "");
  if (!preset.customBaseUrl && !siteMatched && raw.replace(/\/+$/, "") !== preset.baseUrl) throw new AiConnectionValidationError("该服务商的 API 地址是固定的，请切换为自定义服务后再修改。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiConnectionValidationError("API 地址格式不正确，应类似 https://api.example.com/v1。");
  }
  const privateAllowed = allowPrivateBaseUrl();
  if (url.protocol !== "https:" && !(privateAllowed && url.protocol === "http:")) throw new AiConnectionValidationError("API 地址必须使用 HTTPS。");
  if (url.username || url.password || url.search || url.hash) throw new AiConnectionValidationError("API 地址不能包含账号、参数或锚点。");
  if (!privateAllowed && isPrivateHostname(url.hostname)) throw new AiConnectionValidationError("API 地址不能指向本机或内网。自托管本地模型时，可在服务器设置 AI_ALLOW_PRIVATE_BASE_URL=true。");
  return raw.replace(/\/+$/, "");
}

export function normalizeAiModel(value: unknown, fallback = ""): string {
  const model = (typeof value === "string" ? value.trim() : "") || fallback;
  if (!model) throw new AiConnectionValidationError("请填写模型名。");
  if (model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) throw new AiConnectionValidationError("模型名只能包含字母、数字和 . _ : / - 符号。");
  return model;
}

/**
 * 用户未填写地址或模型、且所选服务商与站点环境变量一致时，沿用站点配置。
 * 这样旧版"只提交 DeepSeek Key"的行为保持不变，有无用户 Key 的缓存键也不会分裂。
 */
export function resolveAiConnection(
  input: { provider?: unknown; baseUrl?: unknown; model?: unknown },
  siteDefault?: { provider: string; baseUrl: string; model: string },
): AiConnectionInput {
  const preset = getAiProviderPreset(input.provider);
  const useSiteDefault = siteDefault && preset.id === siteDefault.provider ? siteDefault : null;
  return {
    provider: preset.id,
    baseUrl: normalizeAiBaseUrl((typeof input.baseUrl === "string" && input.baseUrl.trim()) || useSiteDefault?.baseUrl || "", preset, useSiteDefault?.baseUrl),
    model: normalizeAiModel((typeof input.model === "string" && input.model.trim()) || useSiteDefault?.model || "", preset.id === DEFAULT_AI_PROVIDER ? DEFAULT_AI_MODEL : ""),
  };
}

export function supportsThinkingToggle(provider: string) {
  return getAiProviderPreset(provider).supportsThinkingToggle;
}

/**
 * 各类请求的输出 token 预算。结构化 JSON 与中文输出比纯文本更占 token，
 * 推理模型还会把思考 token 计入 max_tokens；预算过紧时服务商会返回
 * finish_reason="length"，表现为"内容被截断"。
 */
export const AI_RESPONSE_TOKEN_BUDGETS: Record<string, number> = {
  TEST: 32,
  EXPLAIN: 1024,
  CONTEXT: 1024,
  GRAMMAR: 1200,
  DICTIONARY_TRANSLATION: 1200,
  QUIZ: 1200,
  QUIZ_JSON: 1200,
  PLAN: 1200,
};
export const AI_DEFAULT_RESPONSE_TOKEN_BUDGET = 1200;
/** 截断自动重试的预算上限，避免重试请求超出服务商的输出上限。 */
export const AI_TRUNCATED_RETRY_MAX_TOKENS = 3072;

export function resolveResponseTokenBudget(requestType: string): number {
  return AI_RESPONSE_TOKEN_BUDGETS[requestType] ?? AI_DEFAULT_RESPONSE_TOKEN_BUDGET;
}

/** 首次请求因长度被截断时放大一次预算；推理模型的思考占用是最常见原因。 */
export function resolveTruncatedRetryBudget(current: number): number {
  if (!Number.isFinite(current) || current <= 0) return AI_TRUNCATED_RETRY_MAX_TOKENS;
  return Math.min(current * 2, AI_TRUNCATED_RETRY_MAX_TOKENS);
}
