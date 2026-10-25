import { prisma } from "@/lib/db";
import { hasHighlightReviewColumns } from "@/lib/highlight-label-schema";
import { HIGHLIGHT_REVIEW_SLOTS } from "@/lib/highlight-review-contract";

const SLOT_SORT_ORDER: Record<string, number> = { QUOTE: 0, UNCLEAR: 1, IMPORTANT: 2 };

// 阅读标签是固定槽位（金句 / 不懂 / 重要），系统不提供创建入口。
// 新账号和历史账号的 HighlightLabel 表可能为空，导致前端只能退回到
// 带占位 ID（legacy-*）的假标签；这些占位 ID 一旦提交到高亮接口会被拒绝。
// 这里按颜色幂等补齐固定槽位，保证前端始终拿到真实标签 ID。
export async function ensureDefaultHighlightLabels(userId: string): Promise<void> {
  const reviewSchemaReady = await hasHighlightReviewColumns();
  for (const slot of HIGHLIGHT_REVIEW_SLOTS) {
    const existing = await prisma.highlightLabel.findFirst({
      where: { userId, color: slot.color, archived: false },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await prisma.highlightLabel.create({
        data: {
          userId,
          name: slot.name,
          color: slot.color,
          sortOrder: SLOT_SORT_ORDER[slot.slotKey] ?? 0,
          ...(reviewSchemaReady ? { slotKey: slot.slotKey, reviewEnabled: slot.reviewEnabled } : {}),
        },
      });
    } catch {
      // 并发补齐或 slotKey 唯一约束冲突时忽略；本次读取稍后会返回已存在的标签。
    }
  }
}
