import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { agents } from "@claw/shared-db";
import { initDb } from "@/lib/db";

const SUPPORTED_LLM_PROVIDERS = ["claude", "openai", "gemini", "ollama", "lmstudio"] as const;
type SupportedLLMProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

const DEFAULT_MODELS: Record<SupportedLLMProvider, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
  lmstudio: "openai/gpt-oss-20b",
};

function isSupportedLLMProvider(provider: string): provider is SupportedLLMProvider {
  return SUPPORTED_LLM_PROVIDERS.includes(provider as SupportedLLMProvider);
}

function getProviderApiKey(provider: SupportedLLMProvider, explicitApiKey?: string): string {
  if (explicitApiKey) return explicitApiKey;

  switch (provider) {
    case "claude":
      return process.env.ANTHROPIC_API_KEY || "";
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    case "gemini":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    case "ollama":
      return "";
    case "lmstudio":
      return process.env.LMSTUDIO_API_KEY || "";
  }
}

function getProviderBaseUrl(provider: SupportedLLMProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_BASE_URL || "";
    case "ollama":
      return process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
    case "lmstudio":
      return process.env.LMSTUDIO_BASE_URL || "http://host.docker.internal:1234";
    default:
      return "";
  }
}

function getDataRoot(): string {
  if (process.env.AFFISTO_DB_PATH) return dirname(process.env.AFFISTO_DB_PATH);
  return join(homedir(), ".affisto");
}

function getAgentDir(agentId: string): string {
  const dir = join(getDataRoot(), "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// GET /api/agents — list all agents
export async function GET() {
  const db = initDb();
  const allAgents = db.select().from(agents).all();

  // Sync Docker status
  for (const a of allAgents) {
    if (a.containerId) {
      try {
        const state = execSync(
          `docker inspect --format '{{.State.Status}}' ${a.containerId}`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        if (state !== a.status) {
          db.update(agents)
            .set({ status: state, updatedAt: new Date() })
            .where(eq(agents.id, a.id))
            .run();
          a.status = state;
        }
      } catch {
        if (a.status !== "no-container") {
          db.update(agents)
            .set({ status: "no-container", updatedAt: new Date() })
            .where(eq(agents.id, a.id))
            .run();
          a.status = "no-container";
        }
      }
    }
  }

  return NextResponse.json(allAgents);
}

// POST /api/agents — create agent
export async function POST(request: Request) {
  const body = (await request.json()) as {
    name: string;
    llm?: string;
    model?: string;
    apiKey?: string;
  };

  const db = initDb();
  const { name, llm = "claude", model, apiKey = "" } = body;

  if (!isSupportedLLMProvider(llm)) {
    return NextResponse.json(
      { error: `Unsupported LLM provider "${llm}"` },
      { status: 400 },
    );
  }

  const existing = db.select().from(agents).where(eq(agents.name, name)).get();
  if (existing) {
    return NextResponse.json({ error: `Agent "${name}" already exists` }, { status: 409 });
  }

  const id = randomUUID();
  const defaultModel = model || DEFAULT_MODELS[llm];
  const resolvedApiKey = getProviderApiKey(llm, apiKey);
  const baseUrl = getProviderBaseUrl(llm);

  db.insert(agents).values({
    id,
    name,
    llmProvider: llm,
    llmModel: defaultModel,
    llmApiKey: resolvedApiKey,
    skills: "[]",
    status: "created",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  // Try to create container
  const existingCount = db.select().from(agents).all().length;
  const agentPort = 4100 + existingCount - 1;

  try {
    const agentDir = getAgentDir(id);
    const containerId = execSync(
      `docker create --name claw-agent-${id.slice(0, 8)} ` +
      `--label claw.agent.id=${id} ` +
      `--label claw.agent.name=${name} ` +
      `-e AGENT_ID=${id} ` +
      `-e AGENT_NAME=${name} ` +
      `-e LLM_PROVIDER=${llm} ` +
      `-e LLM_MODEL=${defaultModel || ""} ` +
      `-e LLM_API_KEY=${resolvedApiKey} ` +
      `-e LLM_BASE_URL=${baseUrl} ` +
      `-e HOST_URL=http://host.docker.internal:3000 ` +
      `-e BRAVE_SEARCH_API_KEY=${process.env.BRAVE_SEARCH_API_KEY || ""} ` +
      `-e AGENT_DATA_DIR=/app/data ` +
      `-v "${agentDir}:/app/data" ` +
      `-p ${agentPort}:3000 ` +
      `--memory=512m ` +
      `claw-agent:latest`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    db.update(agents)
      .set({ containerId, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .run();
  } catch {
    // Image not built yet
  }

  const agent = db.select().from(agents).where(eq(agents.id, id)).get();
  return NextResponse.json(agent, { status: 201 });
}
