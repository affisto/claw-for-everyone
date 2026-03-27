import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  llmProvider: text("llm_provider").notNull(), // claude | openai | gemini | ollama
  llmModel: text("llm_model"),
  llmApiKey: text("llm_api_key"),
  skills: text("skills").notNull().default("[]"), // JSON array
  status: text("status").notNull().default("created"),
  containerId: text("container_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  agentId: text("agent_id").references(() => agents.id),
  html: text("html"),
  template: text("template"),
  data: text("data"), // JSON
  renderMode: text("render_mode").notNull().default("html"), // html | template
  autoRefreshSec: integer("auto_refresh_sec"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sharedResources = sqliteTable("shared_resources", {
  key: text("key").primaryKey(),
  value: text("value"), // JSON
  agentId: text("agent_id").references(() => agents.id),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
