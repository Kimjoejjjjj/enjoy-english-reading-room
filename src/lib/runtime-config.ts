import path from "node:path";
import { assertProductionAuthConfiguration } from "@/lib/auth-config";
import { getAppDataRoot } from "@/lib/app-storage";

function sqlitePathFromDatabaseUrl(value: string) {
  if (!value.startsWith("file:")) throw new Error("Production DATABASE_URL must use SQLite file: storage");
  const raw = value.slice("file:".length).split("?")[0];
  if (!raw || !path.isAbsolute(raw)) throw new Error("Production DATABASE_URL must point to an absolute persistent-disk path");
  return path.resolve(raw);
}

export function assertProductionRuntimeConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  assertProductionAuthConfiguration();
  const appData = getAppDataRoot();
  const database = sqlitePathFromDatabaseUrl(process.env.DATABASE_URL?.trim() || "");
  if (database === path.resolve(process.cwd(), "prisma", "dev.db")) throw new Error("Production database cannot use prisma/dev.db");
  const relative = path.relative(appData, database);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Production SQLite database must be inside APP_DATA_DIR");
  if (process.env.AI_QUOTA_ENABLED !== "false") throw new Error("AI_QUOTA_ENABLED must remain false for the invitation beta launch");
}
