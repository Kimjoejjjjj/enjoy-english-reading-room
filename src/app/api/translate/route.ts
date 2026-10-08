// src/app/api/translate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { word, context } = body;

    if (!word) {
      return NextResponse.json({ error: "Missing word" }, { status: 400 });
    }

    // Try to get Chinese translation using multiple strategies:
    // 1. Free Dictionary API (has some Chinese definitions)
    // 2. Mock translation for development (replace with real API key later)

    const result = await fetchChineseTranslation(word, context || "");

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Translate API error:", err);
    return NextResponse.json(
      { error: err.message || "Translation failed" },
      { status: 500 }
    );
  }
}

async function fetchChineseTranslation(word: string, context: string): Promise<{
  translated: string;
  source: string;
}> {
  const apiKey = process.env.DEEPL_API_KEY;

  if (apiKey) {
    // Use DeepL API for translation
    try {
      const response = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: {
          "Authorization": `DeepL-API-Key ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          text: word,
          target_lang: "ZH",
          source_lang: "EN",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          translated: data.translations?.[0]?.text || word,
          source: "DeepL",
        };
      }
    } catch (err) {
      console.warn("DeepL API failed, falling back to mock:", err);
    }
  }

  // Fallback: mock translation for development
  // In production, replace this with a real translation API call
  const mockTranslations: Record<string, string> = {
    "the": "这个",
    "a": "一个",
    "is": "是",
    "and": "和",
    "or": "或者",
    "to": "到",
    "of": "的",
    "in": "在",
    "for": "为了",
    "on": "在...上",
    "with": "和",
    "at": "在",
    "from": "从",
    "by": "通过",
    "about": "关于",
    "as": "作为",
    "into": "进入",
    "through": "通过",
    "during": "在...期间",
    "before": "在...之前",
    "after": "在...之后",
    "above": "在...之上",
    "below": "在...之下",
    "between": "在...之间",
    "under": "在...下面",
    "again": "再次",
    "further": "进一步",
    "then": "然后",
    "once": "一旦",
    "here": "这里",
    "there": "那里",
    "when": "当...时",
    "where": "哪里",
    "why": "为什么",
    "how": "如何",
    "all": "所有",
    "each": "每个",
    "every": "每一个",
    "but": "但是",
    "which": "哪个",
    "who": "谁",
    "whom": "谁",
    "this": "这个",
    "that": "那个",
    "these": "这些",
    "those": "那些",
    "am": "是",
    "been": "曾经",
    "being": "正在被",
    "have": "有",
    "has": "有",
    "had": "曾经有",
    "having": "拥有",
    "do": "做",
    "does": "做",
    "did": "做过",
    "doing": "正在做",
    "would": "会",
    "should": "应该",
    "could": "能够",
    "might": "可能",
    "must": "必须",
    "shall": "将要",
    "can": "可以",
    "need": "需要",
    "dare": "敢",
    "ought": "应该",
    "used": "使用",
    "get": "得到",
    "got": "得到",
    "make": "制作",
    "made": "制作",
    "know": "知道",
    "knew": "知道",
    "think": "思考",
    "thought": "思考",
    "see": "看",
    "saw": "看到",
    "come": "来",
    "came": "来",
    "take": "拿",
    "took": "拿",
    "give": "给",
    "gave": "给",
    "find": "找到",
    "found": "找到",
    "tell": "告诉",
    "told": "告诉",
    "put": "放",
    "mean": "意思是",
    "meant": "意思是",
    "keep": "保持",
    "kept": "保持",
    "let": "让",
    "begin": "开始",
    "began": "开始",
    "seem": "似乎",
    "help": "帮助",
    "talk": "谈话",
    "turn": "转",
    "start": "开始",
    "show": "展示",
    "hear": "听",
    "play": "玩",
    "run": "跑",
    "move": "移动",
    "like": "喜欢",
    "live": "生活",
    "believe": "相信",
    "hold": "持有",
    "bring": "带来",
    "happen": "发生",
    "write": "写",
    "provide": "提供",
    "sit": "坐",
    "stand": "站",
    "lose": "失去",
    "pay": "支付",
    "met": "遇见",
    "include": "包括",
    "continue": "继续",
    "set": "设置",
    "learn": "学习",
    "change": "改变",
    "lead": "引导",
    "understand": "理解",
    "watch": "观看",
    "follow": "跟随",
    "stop": "停止",
    "create": "创建",
    "speak": "说话",
    "read": "阅读",
    "allow": "允许",
    "add": "添加",
    "spend": "花费",
    "go": "去",
    "wish": "希望",
    "try": "尝试",
    "ask": "问",
    "work": "工作",
    "appear": "出现",
    "feel": "感觉",
    "pass": "通过",
    "grow": "成长",
    "open": "打开",
    "walk": "走",
    "win": "赢得",
    "offer": "提供",
    "remember": "记住",
    "love": "爱",
    "consider": "考虑",
    "alone": "独自",
    "around": "周围",
    "become": "变成",
    "soon": "很快",
    "leave": "离开",
    "wait": "等待",
    "force": "强迫",
    "often": "经常",
    "agree": "同意",
    "close": "关闭",
    "right": "正确的",
    "be": "是",
    "now": "现在",
    "just": "只是",
    "also": "也",
    "very": "非常",
    "more": "更多",
    "many": "许多",
    "most": "大多数",
    "some": "一些",
    "any": "任何",
    "no": "不",
    "not": "不",
    "only": "只有",
    "own": "自己的",
    "same": "相同的",
    "so": "所以",
    "than": "比",
    "too": "太",
    "such": "如此",
  };

  const lowerWord = word.toLowerCase().trim();
  const translated = mockTranslations[lowerWord] || `[翻译: ${word}]`;

  return {
    translated,
    source: "Mock (set DEEPL_API_KEY for real translations)",
  };
}
