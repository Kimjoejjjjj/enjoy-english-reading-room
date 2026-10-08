import { AI_PROVIDER_TIMEOUT_MS, isAiProviderTimeoutFailure } from "@/lib/ai-quota-contract";
import { prisma } from "@/lib/db";
import { decryptAiApiKey } from "@/lib/ai-credential";

export interface AiRequest {
  requestType: "EXPLAIN" | "CONTEXT" | "GRAMMAR" | "QUIZ" | "QUIZ_JSON" | "PLAN" | "TEST" | "DICTIONARY_TRANSLATION";
  text: string;
  context?: string;
  explanationScope?: "FULL_SELECTION";
  explanationLanguage?: "zh-CN" | "en";
  candidates?: AiDictionaryCandidate[];
}

export interface AiDictionaryCandidate {
  id: string;
  partOfSpeech: string | null;
  definition: string;
  example: string | null;
}

export interface AiProviderResult {
  output: string;
  provider: string;
  model?: string;
}

export interface AiProviderConfig {
  configured: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  provider: string;
}

export type AiUsageMode = "byok" | "site_quota" | "unconfigured";

export type AiProviderErrorCode = "INVALID_KEY" | "INVALID_MODEL" | "BALANCE_OR_RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "EMPTY_RESPONSE" | "TRUNCATED" | "INVALID_FORMAT" | "PROVIDER_ERROR";

export class AiProviderError extends Error {
  constructor(public readonly code: AiProviderErrorCode, public readonly status?: number) {
    super(code);
    this.name = "AiProviderError";
  }
}

const staticSystemPrompts: Record<Exclude<AiRequest["requestType"], "EXPLAIN" | "CONTEXT" | "GRAMMAR">, string> = {
  QUIZ: "根据材料生成3道适合B1-B2的理解练习。包含1道词义题、1道细节题、1道简短复述题，并在末尾给答案。用清晰的Markdown。",
  QUIZ_JSON: '根据材料生成 3–5 道适合 B1–B2 的四选一理解题。只返回严格 JSON，不要 Markdown：{"questions":[{"prompt":"题干","context":"可选原文片段","options":["A","B","C","D"],"correctIndex":0,"explanation":"简洁中文解释"}]}。correctIndex 必须为 0–3。',
  PLAN: "根据用户学习数据生成今日30分钟英语学习计划。只给3项可执行任务，并说明调整依据。用中文。",
  TEST: "这是一次服务器连接测试。只回复：连接成功。不要添加其他内容。",
  DICTIONARY_TRANSLATION: '你是谨慎的英汉词典翻译助手。输入是一个英文原形和最多四条带 id 的英文释义。逐条翻译释义，不得增加原文没有的义项，不得合并不同 id，不翻译或改写 id。只返回严格 JSON：{"translations":[{"definitionId":"原 id","translation":"自然、简洁且完整的中文释义"}]}。每个输入 id 必须且只能出现一次。',
};

function explanationLanguage(request: AiRequest) {
  return request.explanationLanguage === "en" ? "en" : "zh-CN";
}

function systemPrompt(request: AiRequest) {
  const language = explanationLanguage(request);
  if (request.requestType === "EXPLAIN") {
    return language === "en"
      ? 'Sit beside the reader as a natural English reading coach. The target is the entire selected span, never a word you choose from inside it. When the selection contains more than one word, the summary must explain the meaning of the whole sentence, phrase, or passage in this context; do not turn it into a dictionary entry for one word. Only after that, use nuance to briefly mention a key word when it materially helps comprehension. Do not repeat the task, force an example, use headings, Markdown, or code fences. Return strict JSON only: {"summary":"one to three natural sentences about the full selection","nuance":"optional short key-word, tone, or implication note; otherwise empty string","paraphrase":"optional plain-English paraphrase of the full selection; otherwise empty string"}.'
      : '你像坐在读者身边的英语阅读教练。目标始终是完整的所选内容，不能自行挑其中一个单词当作解释对象。只要选区超过一个词，summary 必须先解释整句、词组或段落在此处真正表达的意思，不能写成某个单词的词典义。只有确实能帮助理解时，才在 nuance 中简短补充关键词、语气或言外之意。不要复述任务，不要强行举例，不要使用标题、Markdown 或代码围栏。只返回严格 JSON：{"summary":"一至三句解释完整选区","nuance":"可选的关键词、语气或隐含意思，没有则为空字符串","paraphrase":"可选的完整选区自然英文改写，没有则为空字符串"}。';
  }
  if (request.requestType === "GRAMMAR") {
    return language === "en"
      ? 'You are a concise English grammar coach. Return strict JSON only, with exactly these top-level fields: {"summary":"...","points":[{"label":"...","explanation":"...","evidence":"optional source excerpt"}]}. Include 1–6 useful points. Each point must have a short label and explanation; evidence is optional. Keep summary at most 1200 characters, labels at most 80, explanations at most 800, and evidence at most 500. Use natural learner-friendly language. Do not add fields, Markdown, or code fences.'
      : '你是简洁的英语语法老师。只返回严格 JSON，顶层只能有这两个字段：{"summary":"...","points":[{"label":"...","explanation":"...","evidence":"可选原文片段"}]}。points 为 1–6 项。每项必须有简短 label 和 explanation；evidence 可省略。summary 最多 1200 字符，label 最多 80，explanation 最多 800，evidence 最多 500。使用自然、适合学习者的表达。不要添加字段、Markdown 或代码围栏。';
  }
  if (request.requestType === "CONTEXT") {
    return language === "en"
      ? "You are a contextual word-sense selector. The user provides one word, its sentence, and numbered dictionary candidates. Choose only from those candidate IDs; never invent a definition. Return strict JSON only: {\"selectedSenseIds\":[\"id\"],\"meaning\":\"short English explanation\",\"rationale\":\"short reason from this sentence\",\"uncertain\":false}. If uncertain, choose at most two IDs and set uncertain to true."
      : "你是英语阅读词义判断助手。用户会给出单词、当前句子和带编号的词典候选释义。只能从候选编号中选择，不要凭空创造词典义项。只返回严格 JSON：{\"selectedSenseIds\":[\"编号\"],\"meaning\":\"简短中文本文含义\",\"rationale\":\"根据本句的简短依据\",\"uncertain\":false}。不确定时最多选择两个编号，并将 uncertain 设为 true。";
  }
  return staticSystemPrompts[request.requestType];
}

function candidatePrompt(candidates: AiDictionaryCandidate[] | undefined) {
  if (!candidates?.length) return "无可靠候选释义";
  return candidates.map((candidate) => {
    const part = candidate.partOfSpeech ? ` (${candidate.partOfSpeech})` : "";
    const example = candidate.example ? ` Example: ${candidate.example}` : "";
    return `[${candidate.id}]${part} ${candidate.definition}${example}`;
  }).join("\n");
}

function stripJsonFence(value: string) {
  return value.replace(/^```json\s*|\s*```$/gi, "").trim();
}

function usesNonThinkingMode(requestType: AiRequest["requestType"]) {
  return requestType === "TEST" || requestType === "EXPLAIN" || requestType === "CONTEXT" || requestType === "GRAMMAR" || requestType === "DICTIONARY_TRANSLATION";
}

function isStructuredTask(requestType: AiRequest["requestType"]) {
  return requestType === "EXPLAIN" || requestType === "CONTEXT" || requestType === "GRAMMAR" || requestType === "QUIZ_JSON" || requestType === "DICTIONARY_TRANSLATION";
}

export function getAiProviderConfig() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL || "deepseek-flash";
  return {
    configured: Boolean(apiKey && model),
    apiKey,
    baseUrl: (process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model,
    provider: process.env.AI_PROVIDER || "deepseek",
  };
}

export async function resolveAiProviderConfig(userId: string): Promise<{ config: AiProviderConfig; usageMode: AiUsageMode }> {
  const siteConfig = getAiProviderConfig();
  const credential = await prisma.userAiCredential.findUnique({ where: { userId } });
  if (credential) {
    try {
      return { config: { ...siteConfig, configured: true, apiKey: decryptAiApiKey(credential), provider: "deepseek" }, usageMode: "byok" };
    } catch (error) {
      console.error("Stored AI credential is unavailable:", error instanceof Error ? error.name : "unknown");
    }
  }
  return { config: siteConfig, usageMode: siteConfig.configured ? "site_quota" : "unconfigured" };
}

export async function callAiProvider(
  request: AiRequest,
  config: AiProviderConfig = getAiProviderConfig(),
  deadlineOrTimeout: Date | number = AI_PROVIDER_TIMEOUT_MS,
): Promise<AiProviderResult | null> {
  if (!config.configured || !config.apiKey || !config.model) return null;
  const contextLimit = request.requestType === "CONTEXT" ? 1_500 : request.requestType === "EXPLAIN" || request.requestType === "GRAMMAR" ? 2_500 : 8_000;
  const context = request.context?.slice(0, contextLimit);
  const maxTokens = request.requestType === "TEST" ? 32 : request.requestType === "EXPLAIN" || request.requestType === "CONTEXT" ? 400 : request.requestType === "GRAMMAR" || request.requestType === "DICTIONARY_TRANSLATION" ? 600 : 1_200;
  const requestBody: Record<string, unknown> = {
    model: config.model,
    temperature: request.requestType === "EXPLAIN" ? 0.25 : request.requestType === "CONTEXT" ? 0.1 : 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt(request) },
      { role: "user", content: `${request.requestType === "EXPLAIN" ? "完整选区（必须整体解释，不得缩小为其中单词）" : "目标内容"}：${request.text}\n\n上下文：${context || "无"}${request.requestType === "CONTEXT" ? `\n\n词典候选释义：\n${candidatePrompt(request.candidates)}` : ""}` },
    ],
  };
  if (usesNonThinkingMode(request.requestType)) requestBody.thinking = { type: "disabled" };
  if (isStructuredTask(request.requestType)) requestBody.response_format = { type: "json_object" };

  const timeoutMs = deadlineOrTimeout instanceof Date ? deadlineOrTimeout.getTime() - Date.now() : deadlineOrTimeout;
  if (timeoutMs <= 0) throw new AiProviderError("TIMEOUT");
  const timeoutSignal = AbortSignal.timeout(Math.min(timeoutMs, AI_PROVIDER_TIMEOUT_MS));
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: timeoutSignal,
    });
  } catch (error) {
    if (isAiProviderTimeoutFailure(error, timeoutSignal.aborted)) throw new AiProviderError("TIMEOUT");
    throw new AiProviderError("NETWORK");
  }
  if (timeoutSignal.aborted) throw new AiProviderError("TIMEOUT");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AiProviderError("INVALID_KEY", response.status);
    if (response.status === 400 || response.status === 404) throw new AiProviderError("INVALID_MODEL", response.status);
    if (response.status === 402 || response.status === 429) throw new AiProviderError("BALANCE_OR_RATE_LIMIT", response.status);
    throw new AiProviderError("PROVIDER_ERROR", response.status);
  }
  let data: { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
  try {
    data = await response.json() as typeof data;
  } catch (error) {
    if (isAiProviderTimeoutFailure(error, timeoutSignal.aborted)) throw new AiProviderError("TIMEOUT");
    throw new AiProviderError("PROVIDER_ERROR");
  }
  if (timeoutSignal.aborted) throw new AiProviderError("TIMEOUT");
  const choice = data.choices?.[0];
  if (!choice) throw new AiProviderError("EMPTY_RESPONSE");
  if (choice.finish_reason === "length") throw new AiProviderError("TRUNCATED");
  if (choice.finish_reason && choice.finish_reason !== "stop") throw new AiProviderError("PROVIDER_ERROR");
  const output = choice.message?.content?.trim();
  if (!output) throw new AiProviderError("EMPTY_RESPONSE");
  if (isStructuredTask(request.requestType)) {
    try {
      JSON.parse(stripJsonFence(output));
    } catch {
      throw new AiProviderError("INVALID_FORMAT");
    }
  }
  return { output, provider: config.provider, model: data.model || config.model };
}

export function localAiFallback(request: AiRequest): AiProviderResult {
  if (request.requestType === "QUIZ" || request.requestType === "QUIZ_JSON") {
    const excerpt = request.text.replace(/\s+/g, " ").slice(0, 500);
    return {
      provider: "local",
      output: `### 章节练习\n\n1. 用英文概括这段内容的主要事件。\n2. 从原文选择一个不熟悉的词，并根据上下文猜测含义。\n3. 这段内容中哪一句最重要？说明理由。\n\n### 参考材料\n\n${excerpt}`,
    };
  }
  return {
    provider: "local",
    output: explanationLanguage(request) === "en"
      ? `AI is not configured right now. You can still read, use the free English dictionary, add reading marks, and take notes.\n\nSelected text: ${request.text}\n\nConfigure AI_API_KEY and AI_MODEL on the server to request contextual meaning, sentence explanation, and grammar analysis.`
      : `当前未配置 AI 服务。你仍可继续阅读、使用免费英英词典、添加阅读标记和笔记。\n\n所选内容：${request.text}\n\n在服务器配置 AI_API_KEY 与 AI_MODEL 后，可主动获取本文含义、句子解释和语法分析。`,
  };
}
