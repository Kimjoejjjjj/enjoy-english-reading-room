import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

const supportedLanguages = new Set(["zh-CN", "en"]);
const supportedDictionaryTranslationModes = new Set(["manual", "auto"]);

function getExplanationLanguage(value: unknown) {
  return typeof value === "string" && supportedLanguages.has(value) ? value : null;
}

function getDictionaryTranslationMode(value: unknown) {
  return typeof value === "string" && supportedDictionaryTranslationModes.has(value) ? value : null;
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { aiExplanationLanguage: true, dictionaryTranslationMode: true },
  });

  return NextResponse.json({
    explanationLanguage: profile?.aiExplanationLanguage === "en" ? "en" : "zh-CN",
    dictionaryTranslationMode: profile?.dictionaryTranslationMode === "auto" ? "auto" : "manual",
    source: profile ? "account" : "default",
  });
}

export async function PUT(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const explanationLanguage = body.explanationLanguage === undefined ? undefined : getExplanationLanguage(body.explanationLanguage);
  const dictionaryTranslationMode = body.dictionaryTranslationMode === undefined ? undefined : getDictionaryTranslationMode(body.dictionaryTranslationMode);
  if (explanationLanguage === null || dictionaryTranslationMode === null || explanationLanguage === undefined && dictionaryTranslationMode === undefined) return NextResponse.json({ error: "Unsupported AI preference" }, { status: 400 });

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...(explanationLanguage && { aiExplanationLanguage: explanationLanguage }), ...(dictionaryTranslationMode && { dictionaryTranslationMode }) },
    update: { ...(explanationLanguage && { aiExplanationLanguage: explanationLanguage }), ...(dictionaryTranslationMode && { dictionaryTranslationMode }) },
    select: { aiExplanationLanguage: true, dictionaryTranslationMode: true },
  });

  return NextResponse.json({ explanationLanguage: profile.aiExplanationLanguage, dictionaryTranslationMode: profile.dictionaryTranslationMode, source: "account" });
}
