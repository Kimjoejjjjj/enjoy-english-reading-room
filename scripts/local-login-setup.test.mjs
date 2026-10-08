import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = process.cwd();

test("login UI keeps only the resend countdown below the code input", () => {
  const source = readFileSync(join(project, "src", "components", "auth", "LoginPage.tsx"), "utf8");
  assert.doesNotMatch(source, /验证码 10 分钟内有效|The code expires in 10 minutes/);
  assert.match(source, /className="mt-2 flex justify-end/);
  assert.match(source, /resendSeconds > 0 \? `\$\{resendSeconds\}s`/);
});

test("local setup creates secrets once and never overwrites an existing env file", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "enjoy-local-setup-"));
  const script = join(project, "scripts", "setup-local.mjs");
  try {
    const first = spawnSync(process.execPath, [script], { cwd: sandbox, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const envPath = join(sandbox, ".env.local");
    const content = readFileSync(envPath, "utf8");
    const jwt = content.match(/^JWT_SECRET="([a-f0-9]{64})"$/m)?.[1];
    const otp = content.match(/^OTP_HASH_SECRET="([a-f0-9]{64})"$/m)?.[1];
    assert.ok(jwt);
    assert.ok(otp);
    assert.notEqual(jwt, otp);
    assert.match(content, /^LOGIN_ALLOWED_EMAILS="reader@example\.local"$/m);
    assert.match(content, /^RESEND_API_KEY=""$/m);
    assert.match(content, /^RESEND_FROM_EMAIL=""$/m);

    const second = spawnSync(process.execPath, [script], { cwd: sandbox, encoding: "utf8" });
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(envPath, "utf8"), content);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
