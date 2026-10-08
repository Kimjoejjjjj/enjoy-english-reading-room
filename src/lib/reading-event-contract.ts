import { createHash } from "node:crypto";

export function readingEventBindingHash(parts: Record<string, string | null>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function parseReadingEventBinding(body: Record<string, unknown>) {
  return {
    requestId: typeof body.requestId === "string" ? body.requestId : null,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
  };
}
