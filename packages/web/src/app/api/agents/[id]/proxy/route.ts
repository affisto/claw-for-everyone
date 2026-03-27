import { NextResponse, type NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { agents } from "@claw/shared-db";
import { initDb } from "@/lib/db";

function getAgentPort(containerId: string): number | null {
  try {
    const portInfo = execSync(
      `docker port ${containerId} 3000`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const match = portInfo.match(/:(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

// GET /api/agents/:id/proxy?path=/soul
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = request.nextUrl.searchParams.get("path") || "/health";
  const db = initDb();
  const agent = db.select().from(agents).where(eq(agents.id, id)).get();

  if (!agent?.containerId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const port = getAgentPort(agent.containerId);
  if (!port) {
    return NextResponse.json({ error: "Agent not reachable" }, { status: 502 });
  }

  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Agent not responding" }, { status: 502 });
  }
}

// PUT/POST /api/agents/:id/proxy?path=/soul
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = request.nextUrl.searchParams.get("path") || "/";
  const db = initDb();
  const agent = db.select().from(agents).where(eq(agents.id, id)).get();

  if (!agent?.containerId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const port = getAgentPort(agent.containerId);
  if (!port) {
    return NextResponse.json({ error: "Agent not reachable" }, { status: 502 });
  }

  try {
    const body = await request.text();
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Agent not responding" }, { status: 502 });
  }
}

// POST /api/agents/:id/proxy?path=/chat
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = request.nextUrl.searchParams.get("path") || "/";
  const db = initDb();
  const agent = db.select().from(agents).where(eq(agents.id, id)).get();

  if (!agent?.containerId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const port = getAgentPort(agent.containerId);
  if (!port) {
    return NextResponse.json({ error: "Agent not reachable" }, { status: 502 });
  }

  try {
    const body = await request.text();
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Agent not responding" }, { status: 502 });
  }
}
