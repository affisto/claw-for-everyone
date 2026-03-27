// Built-in skill: web-page
// Allows the agent to create and update web pages

export const manifest = {
  name: "web-page",
  description: "Create and update web pages that are served at /p/<slug>",
};

export function getTools() {
  return [
    {
      name: "create_page",
      description:
        "Create or update a web page. The page will be accessible at /p/<slug>. " +
        "Use HTML to create the page content. You can include CSS and JavaScript inline.",
      input_schema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "URL slug for the page (e.g. 'dashboard', 'report-2024')",
          },
          title: {
            type: "string",
            description: "Page title",
          },
          html: {
            type: "string",
            description: "Full HTML content of the page",
          },
        },
        required: ["slug", "title", "html"],
      },
    },
    {
      name: "list_pages",
      description: "List all pages created by agents",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

export async function handleToolCall(toolName, input, context) {
  const { hostUrl, agentId } = context;

  if (toolName === "create_page") {
    const res = await fetch(`${hostUrl}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: input.slug,
        title: input.title,
        html: input.html,
        agentId,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: `Failed to create page: ${err}` };
    }

    const page = await res.json();
    return {
      success: true,
      message: `Page created at /p/${page.slug}`,
      url: `${hostUrl}/p/${page.slug}`,
    };
  }

  if (toolName === "list_pages") {
    const res = await fetch(`${hostUrl}/api/pages`);
    if (!res.ok) return { error: "Failed to list pages" };
    const pages = await res.json();
    return {
      pages: pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        url: `${hostUrl}/p/${p.slug}`,
        updatedAt: p.updatedAt,
      })),
    };
  }

  return { error: `Unknown tool: ${toolName}` };
}
