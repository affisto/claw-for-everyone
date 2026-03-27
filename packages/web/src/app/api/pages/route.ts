import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pages } from "@claw/shared-db";
import { initDb } from "@/lib/db";

// GET /api/pages — list all pages
export async function GET() {
  const db = initDb();
  const allPages = db.select().from(pages).all();
  return NextResponse.json(allPages);
}

// POST /api/pages — create or update a page
export async function POST(request: Request) {
  const body = (await request.json()) as {
    slug: string;
    title: string;
    html?: string;
    template?: string;
    data?: string;
    renderMode?: string;
    agentId?: string;
    autoRefreshSec?: number;
  };

  const db = initDb();
  const existing = db.select().from(pages).where(eq(pages.slug, body.slug)).get();

  if (existing) {
    db.update(pages)
      .set({
        title: body.title || existing.title,
        html: body.html ?? existing.html,
        template: body.template ?? existing.template,
        data: body.data ?? existing.data,
        renderMode: body.renderMode || existing.renderMode,
        autoRefreshSec: body.autoRefreshSec ?? existing.autoRefreshSec,
        updatedAt: new Date(),
      })
      .where(eq(pages.slug, body.slug))
      .run();

    const updated = db.select().from(pages).where(eq(pages.slug, body.slug)).get();
    return NextResponse.json(updated);
  }

  const id = randomUUID();
  db.insert(pages).values({
    id,
    slug: body.slug,
    title: body.title,
    html: body.html,
    template: body.template,
    data: body.data,
    renderMode: body.renderMode || "html",
    agentId: body.agentId,
    autoRefreshSec: body.autoRefreshSec,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  const page = db.select().from(pages).where(eq(pages.id, id)).get();
  return NextResponse.json(page, { status: 201 });
}
