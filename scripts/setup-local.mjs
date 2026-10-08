import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");

if (existsSync(target)) {
  console.error(".env.local already exists. It was not changed.");
  process.exit(1);
}

const secret = () => randomBytes(32).toString("hex");
const content = `DATABASE_URL="file:./dev.db"
JWT_SECRET="${secret()}"
OTP_HASH_SECRET="${secret()}"
LOGIN_ALLOWED_EMAILS="reader@example.local"
RESEND_API_KEY=""
RESEND_FROM_EMAIL=""
TRUST_PROXY_HOPS="0"
APP_DATA_DIR=""

AI_API_KEY=""
AI_BASE_URL="https://api.deepseek.com"
AI_MODEL="deepseek-flash"
AI_PROVIDER="deepseek"
AI_DAILY_LIMIT="20"
AI_QUOTA_ENABLED="false"
AI_CREDENTIAL_ENCRYPTION_KEY=""
`;

writeFileSync(target, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log("Created .env.local with random local secrets.");
console.log("Local login email: reader@example.local");
console.log("With npm run dev, verification codes will be printed in this terminal.");
