import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { pages } from "./schema.js";

export class WebRenderer {
  async getPage(slug: string) {
    const db = getDb();
    const [page] = await db.select().from(pages).where(eq(pages.slug, slug));
    if (!page) return null;

    if (page.renderMode === "html") {
      return page.html;
    }

    // Template mode: replace {{key}} with data values
    if (page.renderMode === "template" && page.template && page.data) {
      const data = JSON.parse(page.data) as Record<string, string>;
      let rendered = page.template;
      for (const [key, value] of Object.entries(data)) {
        rendered = rendered.replaceAll(`{{${key}}}`, value);
      }
      return rendered;
    }

    return page.html;
  }

  async listPages() {
    const db = getDb();
    return db
      .select({
        slug: pages.slug,
        title: pages.title,
        agentId: pages.agentId,
        updatedAt: pages.updatedAt,
      })
      .from(pages);
  }
}
