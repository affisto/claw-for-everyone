// Built-in skill: web-search
// Allows the agent to search the web and fetch URLs

export const manifest = {
  name: "web-search",
  description: "Search the web and fetch content from URLs",
};

export function getTools() {
  return [
    {
      name: "search_web",
      description:
        "Search the web for information. Returns a list of relevant results with titles, URLs, and descriptions. " +
        "Use this when you need current information, facts, news, or anything not in your training data.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          count: {
            type: "number",
            description: "Number of results to return (default: 5, max: 10)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch_url",
      description:
        "Fetch and extract the main text content from a URL. Use this to read articles, documentation, or any web page. " +
        "Returns the extracted text content (HTML tags stripped).",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
        },
        required: ["url"],
      },
    },
  ];
}

async function searchBrave(query, count = 5) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BRAVE_SEARCH_API_KEY is required for web search. " +
      "Get a free key at https://brave.com/search/api/",
    );
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 10)),
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brave Search API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const results = (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));

  return results;
}

function stripHtml(html) {
  // Remove script and style tags with content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ClawAgent/1.0)",
      Accept: "text/html,application/xhtml+xml,text/plain",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();

  if (contentType.includes("text/html")) {
    const text = stripHtml(body);
    // Truncate to ~8000 chars to fit in context
    return text.length > 8000 ? text.slice(0, 8000) + "... [truncated]" : text;
  }

  // Plain text or other
  return body.length > 8000 ? body.slice(0, 8000) + "... [truncated]" : body;
}

export async function handleToolCall(toolName, input, _context) {
  if (toolName === "search_web") {
    try {
      const results = await searchBrave(input.query, input.count || 5);
      if (results.length === 0) {
        return { message: "No results found.", results: [] };
      }
      return { results };
    } catch (err) {
      return { error: err.message };
    }
  }

  if (toolName === "fetch_url") {
    try {
      const content = await fetchUrl(input.url);
      return { url: input.url, content };
    } catch (err) {
      return { error: err.message };
    }
  }

  return { error: `Unknown tool: ${toolName}` };
}
