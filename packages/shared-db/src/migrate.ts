import { getDb } from "./db.js";
import { sql } from "drizzle-orm";

export function migrate() {
  const db = getDb();
  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      llm_provider TEXT NOT NULL,
      llm_model TEXT,
      llm_api_key TEXT,
      skills TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'created',
      container_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      agent_id TEXT REFERENCES agents(id),
      html TEXT,
      template TEXT,
      data TEXT,
      render_mode TEXT NOT NULL DEFAULT 'html',
      auto_refresh_sec INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS channel_configs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      channel_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS shared_resources (
      key TEXT PRIMARY KEY,
      value TEXT,
      agent_id TEXT REFERENCES agents(id),
      updated_at INTEGER NOT NULL
    )
  `);
}
