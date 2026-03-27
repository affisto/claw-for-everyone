import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle> | null = null;

export function createDb(dbPath = "claw.db") {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  db = drizzle(sqlite, { schema });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call createDb() first.");
  return db;
}
