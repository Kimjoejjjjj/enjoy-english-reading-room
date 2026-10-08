// src/app/api/auth/send-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { assertProductionAuthConfiguration, isValidLoginEmail, normalizeLoginEmail } from "@/lib/auth-config";
import { GENERIC_SEND_CODE_MESSAGE, issueLoginCode } from "@/lib/email-login";

export async function POST(req: NextRequest) {
  try {
    assertProductionAuthConfiguration();
    const body = await req.json().catch(() => null) as { email?: unknown } | null;
    const email = normalizeLoginEmail(body?.email);
    if (!isValidLoginEmail(email)) return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    const result = await issueLoginCode(req, email);
    if (result === "provider-unavailable") console.error("Login email provider unavailable");
    return NextResponse.json({ success: true, message: GENERIC_SEND_CODE_MESSAGE }, { status: 202 });
  } catch (error) {
    console.error("Login email service unavailable", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Login email service is unavailable" }, { status: 503 });
  }
}
