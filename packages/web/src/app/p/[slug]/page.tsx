import { initDb } from "@/lib/db";
import { pages } from "@claw/shared-db";
import { eq } from "drizzle-orm";

export default async function RenderedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = initDb();
  const page = db.select().from(pages).where(eq(pages.slug, slug)).get();

  if (!page) {
    return (
      <main style={{ maxWidth: 600, margin: "4rem auto", textAlign: "center" }}>
        <h1>Page not found</h1>
        <p>No page with slug &quot;{slug}&quot; exists.</p>
      </main>
    );
  }

  let html = page.html || "";

  if (page.renderMode === "template" && page.template && page.data) {
    const data = JSON.parse(page.data) as Record<string, string>;
    html = page.template;
    for (const [key, value] of Object.entries(data)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
  }

  return (
    <>
      {page.autoRefreshSec && (
        <meta httpEquiv="refresh" content={String(page.autoRefreshSec)} />
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
