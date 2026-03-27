import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { agents } from "@claw/shared-db";
import { initDb } from "@/lib/db";

// GET /api/agents/:id/port — get the agent's host port
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = initDb();
  const agent = db.select().from(agents).where(eq(agents.id, id)).get();

  if (!agent?.containerId) {
    return NextResponse.json({ error: "Agent not found or no container" }, { status: 404 });
  }

  try {
    const portInfo = execSync(
      `docker port ${agent.containerId} 3000`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const match = portInfo.match(/:(\d+)$/);
    if (match) {
      return NextResponse.json({ port: parseInt(match[1], 10) });
    }
  } catch {
    // container might not be running
  }

  return NextResponse.json({ error: "Port not available" }, { status: 404 });
}
