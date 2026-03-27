import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { agents } from "@claw/shared-db";
import { initDb } from "@/lib/db";

// POST /api/agents/:id — actions: start, stop
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { action: "start" | "stop" };
  const db = initDb();

  const agent = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!agent.containerId) {
    return NextResponse.json({ error: "Agent has no container" }, { status: 400 });
  }

  try {
    if (body.action === "start") {
      execSync(`docker start ${agent.containerId}`, { stdio: ["pipe", "pipe", "pipe"] });
      db.update(agents)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .run();
    } else if (body.action === "stop") {
      execSync(`docker stop ${agent.containerId}`, { stdio: ["pipe", "pipe", "pipe"] });
      db.update(agents)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .run();
    }
  } catch (err) {
    return NextResponse.json({ error: `Failed to ${body.action} agent` }, { status: 500 });
  }

  const updated = db.select().from(agents).where(eq(agents.id, id)).get();
  return NextResponse.json(updated);
}

// DELETE /api/agents/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = initDb();

  const agent = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.containerId) {
    try {
      execSync(`docker rm -f ${agent.containerId}`, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // container may not exist
    }
  }

  db.delete(agents).where(eq(agents.id, id)).run();
  return NextResponse.json({ ok: true });
}
