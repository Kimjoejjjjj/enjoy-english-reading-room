import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getEmailDeliveryConfig, getOtpHashSecret, hashClientIp, isLoginEmailAllowed, normalizeLoginEmail } from "@/lib/auth-config";

const CODE_TTL_MS = 10 * 60_000;
const EMAIL_COOLDOWN_MS = 60_000;
const HOURLY_WINDOW_MS = 60 * 60_000;
const MAX_EMAIL_SENDS_PER_HOUR = 5;
const MAX_IP_SENDS_PER_HOUR = 20;
const MAX_CODE_ATTEMPTS = 5;

export const GENERIC_SEND_CODE_MESSAGE = "If this email is invited, a verification code will be sent.";
export const GENERIC_LOGIN_ERROR = "Invalid or expired verification code";
let claimQueue: Promise<void> = Promise.resolve();

async function serializeClaim<T>(work: () => Promise<T>) {
  const previous = claimQueue;
  let release = () => {};
  claimQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

function codeHash(id: string, email: string, code: string) {
  return createHmac("sha256", getOtpHashSecret()).update(`${id}:${email}:${code}`).digest("hex");
}

function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendLoginCode(email: string, code: string) {
  const delivery = getEmailDeliveryConfig();
  if (delivery.mode === "console") {
    console.info(`[local-login] Verification code for ${email}: ${code}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${delivery.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: delivery.from,
      to: [email],
      subject: "Enjoy English 登录验证码",
      text: `你的登录验证码是 ${code}。验证码将在 10 分钟后失效，请勿转发给他人。`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status})`);
}

export type SendCodeResult = "generic" | "cooldown" | "limited" | "provider-unavailable";

export async function issueLoginCode(req: NextRequest, rawEmail: string, now = new Date(), sender = sendLoginCode): Promise<SendCodeResult> {
  const email = normalizeLoginEmail(rawEmail);
  if (!isLoginEmailAllowed(email)) return "generic";
  const requestIpHash = hashClientIp(req);
  const hourStart = new Date(now.getTime() - HOURLY_WINDOW_MS);
  const cooldownStart = new Date(now.getTime() - EMAIL_COOLDOWN_MS);
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const claim = await serializeClaim(() => prisma.$transaction(async (tx) => {
    await tx.emailLoginCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * HOURLY_WINDOW_MS) } } });
    const [recentForEmail, hourlyForEmail, hourlyForIp] = await Promise.all([
      tx.emailLoginCode.count({ where: { email, createdAt: { gte: cooldownStart } } }),
      tx.emailLoginCode.count({ where: { email, createdAt: { gte: hourStart } } }),
      tx.emailLoginCode.count({ where: { requestIpHash, createdAt: { gte: hourStart } } }),
    ]);
    if (recentForEmail > 0) return "cooldown" as const;
    if (hourlyForEmail >= MAX_EMAIL_SENDS_PER_HOUR || hourlyForIp >= MAX_IP_SENDS_PER_HOUR) return "limited" as const;
    await tx.emailLoginCode.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: now } });
    await tx.emailLoginCode.create({ data: { id, email, codeHash: codeHash(id, email, code), requestIpHash, expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now } });
    return "claimed" as const;
  }));
  if (claim !== "claimed") return claim;
  try {
    await sender(email, code);
    return "generic";
  } catch {
    await prisma.emailLoginCode.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } }).catch(() => undefined);
    return "provider-unavailable";
  }
}

export async function consumeLoginCode(rawEmail: string, code: string, now = new Date()) {
  const email = normalizeLoginEmail(rawEmail);
  if (!isLoginEmailAllowed(email)) return false;
  return prisma.$transaction(async (tx) => {
    const active = await tx.emailLoginCode.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (!active || active.attemptCount >= MAX_CODE_ATTEMPTS) return false;
    const valid = hashesMatch(active.codeHash, codeHash(active.id, email, code));
    const nextAttemptCount = active.attemptCount + (valid ? 0 : 1);
    const update = await tx.emailLoginCode.updateMany({
      where: { id: active.id, consumedAt: null, attemptCount: active.attemptCount },
      data: valid
        ? { consumedAt: now }
        : { attemptCount: nextAttemptCount, ...(nextAttemptCount >= MAX_CODE_ATTEMPTS ? { consumedAt: now } : {}) },
    });
    return valid && update.count === 1;
  });
}
