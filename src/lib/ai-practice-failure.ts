export function getAiPracticeFallbackMessage(reason: string): string {
  if (reason === "AI_LIMIT") return "今日 AI 额度已用完，已自动使用基础练习。";
  if (reason === "AI_ATTEMPT_LIMIT") return "近期 AI 请求次数过多，已自动使用基础练习。";
  if (reason === "AI_NOT_CONFIGURED") return "未配置 AI，已自动使用基础练习。";
  if (reason === "AI_QUOTA_CONFIGURATION") return "服务器 AI_DAILY_LIMIT 配置无效，暂无法使用 AI，已自动使用基础练习。";
  if (reason === "TIMEOUT") return "AI 响应超时，本次未扣除额度，已自动使用基础练习。";
  return "AI 题目格式不稳定，已自动使用基础练习。";
}