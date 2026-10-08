// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/auth";
import { assertProductionAuthConfiguration, isValidLoginEmail, normalizeLoginEmail } from "@/lib/auth-config";
import { prisma } from "@/lib/db";
import { consumeLoginCode, GENERIC_LOGIN_ERROR } from "@/lib/email-login";

export async function POST(req: NextRequest) {
  try {
    assertProductionAuthConfiguration();
    const body = await req.json().catch(() => null) as { email?: unknown; code?: unknown } | null;
    const email = normalizeLoginEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!isValidLoginEmail(email) || !/^\d{6}$/.test(code)) return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    if (!await consumeLoginCode(email, code)) return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name: email.split("@")[0] },
      update: {},
      select: { id: true, email: true, name: true, avatarUrl: true },
    });

    const token = signToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    console.error('Login unavailable:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json(
      { error: 'Login is unavailable' },
      { status: 503 }
    );
  }
}
