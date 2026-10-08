import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSECURE_SECRETS = new Set(["your-secret-key-change-in-production", "replace-with-a-long-random-secret"]);

export function normalizeLoginEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidLoginEmail(email: string) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

function requiredSecret(name: "JWT_SECRET" | "OTP_HASH_SECRET", minimumLength = 32) {
  const value = process.env[name]?.trim() || "";
  const requiredLength = process.env.NODE_ENV === "production" ? minimumLength : 16;
  if (value.length < requiredLength || INSECURE_SECRETS.has(value)) {
    throw new Error(`${name} must be a non-default secret of at least ${requiredLength} characters`);
  }
  return value;
}

export function getJwtSecret() {
  return requiredSecret("JWT_SECRET");
}

export function getOtpHashSecret() {
  return requiredSecret("OTP_HASH_SECRET");
}

export function getAllowedLoginEmails() {
  const emails = new Set(
    (process.env.LOGIN_ALLOWED_EMAILS || "")
      .split(",")
      .map(normalizeLoginEmail)
      .filter(isValidLoginEmail),
  );
  if (process.env.NODE_ENV === "production" && emails.size === 0) {
    throw new Error("LOGIN_ALLOWED_EMAILS must contain at least one valid email in production");
  }
  return emails;
}

export function isLoginEmailAllowed(email: string) {
  return getAllowedLoginEmails().has(normalizeLoginEmail(email));
}

export function getEmailDeliveryConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "";
  if (apiKey && isValidLoginEmail(from)) return { mode: "resend" as const, apiKey, from };
  if (process.env.NODE_ENV !== "production" && !apiKey && !from) return { mode: "console" as const };
  throw new Error("RESEND_API_KEY and a valid RESEND_FROM_EMAIL must be configured together");
}

export function assertEmailProviderConfigured() {
  const config = getEmailDeliveryConfig();
  if (config.mode !== "resend") throw new Error("RESEND_API_KEY and a valid RESEND_FROM_EMAIL are required in production");
  return config;
}

function trustedProxyHops() {
  const parsed = Number.parseInt(process.env.TRUST_PROXY_HOPS || "0", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 0;
}

export function getClientIp(req: NextRequest) {
  const hops = trustedProxyHops();
  if (hops > 0) {
    const chain = (req.headers.get("x-forwarded-for") || "").split(",").map((value) => value.trim()).filter(Boolean);
    const candidate = chain[chain.length - hops];
    if (candidate) return candidate.slice(0, 128);
    const realIp = req.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp.slice(0, 128);
  }
  return "untrusted-proxy";
}

export function hashClientIp(req: NextRequest) {
  return createHmac("sha256", getOtpHashSecret()).update(getClientIp(req)).digest("hex");
}

export function assertProductionAuthConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  getJwtSecret();
  getOtpHashSecret();
  getAllowedLoginEmails();
  assertEmailProviderConfigured();
  if (trustedProxyHops() < 1) throw new Error("TRUST_PROXY_HOPS must be at least 1 in production");
}
