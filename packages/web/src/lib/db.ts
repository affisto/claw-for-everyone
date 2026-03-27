import { join } from "node:path";
import { homedir } from "node:os";
import { createDb, getDb as getDbInstance, migrate } from "@claw/shared-db";

let initialized = false;

function getDbPath() {
  return process.env.AFFISTO_DB_PATH || join(homedir(), ".affisto", "claw.db");
}

export function initDb() {
  if (!initialized) {
    createDb(getDbPath());
    migrate();
    initialized = true;
  }
  return getDbInstance();
}
