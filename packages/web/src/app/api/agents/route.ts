import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { agents } from "@claw/shared-db";
import { initDb } from "@/lib/db";

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

  const existing = db.select().from(agents).where(eq(agents.name, name)).get();
  if (existing) {
    return NextResponse.json({ error: `Agent "${name}" already exists` }, { status: 409 });
  }

  const id = randomUUID();
  const defaultModel = llm === "claude" ? "claude-sonnet-4-20250514" : model;

  db.insert(agents).values({
    id,
    name,
    llmProvider: llm,
    llmModel: defaultModel,
    llmApiKey: apiKey,
    skills: "[]",
    status: "created",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  // Try to create container
  const existingCount = db.select().from(agents).all().length;
  const agentPort = 4100 + existingCount - 1;

  try {
    const containerId = execSync(
      `docker create --name claw-agent-${id.slice(0, 8)} ` +
      `--label claw.agent.id=${id} ` +
      `--label claw.agent.name=${name} ` +
      `-e AGENT_ID=${id} ` +
      `-e AGENT_NAME=${name} ` +
      `-e LLM_PROVIDER=${llm} ` +
      `-e LLM_MODEL=${defaultModel || ""} ` +
      `-e LLM_API_KEY=${apiKey} ` +
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
