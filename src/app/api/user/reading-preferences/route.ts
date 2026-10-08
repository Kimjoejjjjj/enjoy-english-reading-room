import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_READING_PREFERENCES, normalizeReadingPreferences } from "@/lib/reading-preferences";

const preferenceSelect = {
  readingPreset1: true,
  readingPreset2: true,
  readingPreset3: true,
  defaultReadingMinutes: true,
  idlePauseMinutes: true,
} as const;

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: preferenceSelect });
  if (!profile) return NextResponse.json(DEFAULT_READING_PREFERENCES);
  return NextResponse.json({
    presets: [profile.readingPreset1, profile.readingPreset2, profile.readingPreset3],
    defaultMinutes: profile.defaultReadingMinutes,
    idlePauseMinutes: profile.idlePauseMinutes,
    source: "account",
  });
}

export async function PUT(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const preferences = normalizeReadingPreferences(await req.json());
    const data = {
      readingPreset1: preferences.presets[0],
      readingPreset2: preferences.presets[1],
      readingPreset3: preferences.presets[2],
      defaultReadingMinutes: preferences.defaultMinutes,
      idlePauseMinutes: preferences.idlePauseMinutes,
    };
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: preferenceSelect,
    });
    return NextResponse.json({
      presets: [profile.readingPreset1, profile.readingPreset2, profile.readingPreset3],
      defaultMinutes: profile.defaultReadingMinutes,
      idlePauseMinutes: profile.idlePauseMinutes,
      source: "account",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid reading preferences" }, { status: 400 });
  }
}
