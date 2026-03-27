import { join } from "node:path";
import { homedir } from "node:os";
import { createDb, getDb as getDbInstance, migrate } from "@claw/shared-db";

let initialized = false;

export function initDb() {
  if (!initialized) {
    const dbPath = join(homedir(), ".affisto", "claw.db");
    createDb(dbPath);
    migrate();
    initialized = true;
  }
  return getDbInstance();
}
