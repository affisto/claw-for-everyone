#!/usr/bin/env node
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENT_ID = process.env.AGENT_ID;
const AGENT_NAME = process.env.AGENT_NAME || "unnamed";
const LLM_PROVIDER = process.env.LLM_PROVIDER || "claude";
const LLM_MODEL = process.env.LLM_MODEL || "";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_OAUTH_TOKEN = process.env.LLM_OAUTH_TOKEN || "";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "";
const KNOWLEDGE_DIR = process.env.AGENT_KNOWLEDGE_DIR
  || join(process.env.AGENT_DATA_DIR || join(__dirname, "data"), "knowledge");
const HOST_URL = process.env.HOST_URL || "http://host.docker.internal:3000";
const AGENT_SKILLS = (process.env.AGENT_SKILLS || "").split(",").filter(Boolean);

const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
  lmstudio: "openai/gpt-oss-20b",
};

// --- Skill Loading ---
const loadedSkills = new Map();
let allTools = [];

async function loadSkills() {
  const skillsDir = join(__dirname, "skills");
  let files;
  try {
    files = await readdir(skillsDir);
  } catch {
    console.log(`[Agent ${AGENT_NAME}] No skills directory found`);
    return;
  }

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const skillName = file.replace(".js", "");

    // Only load skills that are installed for this agent
    if (AGENT_SKILLS.length > 0 && !AGENT_SKILLS.includes(skillName)) continue;

    try {
      const skill = await import(join(skillsDir, file));
      loadedSkills.set(skillName, skill);
      const tools = skill.getTools?.() || [];
      allTools.push(...tools);
      console.log(`[Agent ${AGENT_NAME}] Loaded skill: ${skill.manifest?.name || skillName} (${tools.length} tools)`);
    } catch (err) {
      console.error(`[Agent ${AGENT_NAME}] Failed to load skill ${skillName}:`, err.message);
    }
  }
}

async function handleToolCall(toolName, toolInput) {
  for (const [, skill] of loadedSkills) {
    if (skill.handleToolCall) {
      const tools = skill.getTools?.() || [];
      if (tools.some((t) => t.name === toolName)) {
        return skill.handleToolCall(toolName, toolInput, {
          hostUrl: HOST_URL,
          agentId: AGENT_ID,
          agentName: AGENT_NAME,
        });
      }
    }
  }
  return { error: `No skill handles tool: ${toolName}` };
}

function getModel() {
  return LLM_MODEL || DEFAULT_MODELS[LLM_PROVIDER] || DEFAULT_MODELS.claude;
}

function getBaseUrl() {
  if (LLM_BASE_URL) return LLM_BASE_URL;
  if (LLM_PROVIDER === "openai") return "https://api.openai.com";
  if (LLM_PROVIDER === "gemini") return "https://generativelanguage.googleapis.com";
  if (LLM_PROVIDER === "ollama") return "http://host.docker.internal:11434";
  if (LLM_PROVIDER === "lmstudio") return "http://host.docker.internal:1234";
  return "";
}

function getClaudeHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (LLM_OAUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${LLM_OAUTH_TOKEN}`;
  } else if (LLM_API_KEY) {
    headers["x-api-key"] = LLM_API_KEY;
  }
  return headers;
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

async function loadKnowledge() {
  let entries;
  try {
    entries = await readdir(KNOWLEDGE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name));

  const knowledge = [];
  for (const file of files) {
    const content = await readFile(join(KNOWLEDGE_DIR, file.name), "utf8");
    if (content.trim()) {
      knowledge.push({ name: file.name, content: content.trim() });
    }
  }

  return knowledge;
}

// --- Claude API with Tool Use ---
async function chatClaude(messages) {
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model: getModel(),
    max_tokens: 4096,
    system: systemMessage?.content,
    messages: chatMessages,
  };

  // Add tools if any skills are loaded
  if (allTools.length > 0) {
    body.tools = allTools;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: getClaudeHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();

  // Handle tool use - Claude may want to call tools
  if (data.stop_reason === "tool_use") {
    const toolResults = [];
    let textReply = "";

    for (const block of data.content) {
      if (block.type === "text") {
        textReply += block.text;
      }
      if (block.type === "tool_use") {
        console.log(`[Agent ${AGENT_NAME}] Tool call: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`);
        const result = await handleToolCall(block.name, block.input);
        console.log(`[Agent ${AGENT_NAME}] Tool result: ${JSON.stringify(result).slice(0, 100)}...`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Send tool results back to Claude for final response
    chatMessages.push({ role: "assistant", content: data.content });
    chatMessages.push({ role: "user", content: toolResults });

    const followUp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": LLM_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: chatMessages,
        tools: allTools.length > 0 ? allTools : undefined,
      }),
    });

    if (!followUp.ok) {
      const err = await followUp.text();
      throw new Error(`Claude API error: ${followUp.status} ${err}`);
    }

    const followUpData = await followUp.json();
    const textBlocks = followUpData.content.filter((b) => b.type === "text");
    return textReply + textBlocks.map((b) => b.text).join("");
  }

  // Normal text response
  const textBlocks = data.content.filter((b) => b.type === "text");
  return textBlocks.map((b) => b.text).join("");
}

async function chatOpenAI(messages) {
  if (!LLM_API_KEY) throw new Error("OpenAI requires LLM_API_KEY");
  return chatOpenAICompatible(messages, true);
}

async function chatLmStudio(messages) {
  return chatOpenAICompatible(messages, false);
}

async function chatOpenAICompatible(messages, requireApiKey) {
  if (requireApiKey && !LLM_API_KEY) throw new Error("OpenAI requires LLM_API_KEY");

  const headers = {
    "Content-Type": "application/json",
  };
  if (LLM_API_KEY) {
    headers.Authorization = `Bearer ${LLM_API_KEY}`;
  }

  const res = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 4096,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return extractTextContent(data.choices?.[0]?.message?.content);
}

async function chatGemini(messages) {
  if (!LLM_API_KEY) throw new Error("Gemini requires LLM_API_KEY");

  const systemMessage = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const res = await fetch(
    `${getBaseUrl()}/v1beta/models/${getModel()}:generateContent?key=${LLM_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        system_instruction: systemMessage
          ? { parts: [{ text: systemMessage.content }] }
          : undefined,
        generationConfig: {
          maxOutputTokens: 4096,
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function chatOllama(messages) {
  const res = await fetch(`${getBaseUrl()}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      stream: false,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.message?.content || "";
}

// --- HTTP Server ---
const conversationHistory = [];

async function loadSoul() {
  const soulPath = join(process.env.AGENT_DATA_DIR || join(__dirname, "data"), "SOUL.md");
  try {
    const content = await readFile(soulPath, "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function loadCron() {
  const cronPath = join(process.env.AGENT_DATA_DIR || join(__dirname, "data"), "CRON.md");
  try {
    const content = await readFile(cronPath, "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function getSystemPrompt() {
  // SOUL.md defines the agent's identity. If present, it replaces the default prompt.
  const soul = await loadSoul();
  let prompt;
  if (soul) {
    prompt = soul.replace(/\{\{AGENT_NAME\}\}/g, AGENT_NAME);
  } else {
    prompt = `You are ${AGENT_NAME}, an AI agent running in a container. You are helpful, concise, and friendly.`;
  }

  // Skills awareness
  if (allTools.length > 0) {
    const skillNames = Array.from(loadedSkills.values())
      .map((s) => s.manifest?.name)
      .filter(Boolean);
    prompt += `\n\nYou have the following skills installed: ${skillNames.join(", ")}.`;
    prompt += `\nUse the available tools when appropriate to fulfill user requests.`;
    prompt += `\nIMPORTANT: If a user asks you to do something that requires a skill you don't have, tell them which skill they need to install and stop. Do NOT attempt actions beyond your installed skills.`;
  } else {
    prompt += `\n\nYou have no skills installed. You can only have conversations. If a user asks you to take actions (search the web, create pages, etc.), tell them to install the appropriate skill first.`;
  }

  // Knowledge
  const knowledge = await loadKnowledge();
  if (knowledge.length > 0) {
    prompt += "\n\nUse the following taught knowledge when it is relevant:";
    for (const item of knowledge) {
      prompt += `\n\n[Knowledge: ${item.name}]\n${item.content}`;
    }
  }

  // CRON.md awareness
  const cron = await loadCron();
  if (cron) {
    prompt += `\n\nYou have scheduled tasks defined. The runtime handles execution on schedule. Here are your recurring tasks:\n${cron}`;
  }

  return prompt;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      agent: AGENT_NAME,
      id: AGENT_ID,
      skills: Array.from(loadedSkills.keys()),
      tools: allTools.map((t) => t.name),
    }));
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { message } = JSON.parse(body);
      console.log(`[Agent ${AGENT_NAME}] Received: ${message}`);

      conversationHistory.push({ role: "user", content: message });

      const messages = [
        { role: "system", content: await getSystemPrompt() },
        ...conversationHistory,
      ];

      let reply;
      if (LLM_PROVIDER === "claude") {
        reply = await chatClaude(messages);
      } else if (LLM_PROVIDER === "openai") {
        reply = await chatOpenAI(messages);
      } else if (LLM_PROVIDER === "lmstudio") {
        reply = await chatLmStudio(messages);
      } else if (LLM_PROVIDER === "gemini") {
        reply = await chatGemini(messages);
      } else if (LLM_PROVIDER === "ollama") {
        reply = await chatOllama(messages);
      } else {
        throw new Error(`Unsupported provider: ${LLM_PROVIDER}`);
      }

      conversationHistory.push({ role: "assistant", content: reply });
      console.log(`[Agent ${AGENT_NAME}] Reply: ${reply.slice(0, 100)}...`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error(`[Agent ${AGENT_NAME}] Error:`, err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/reset") {
    conversationHistory.length = 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "conversation reset" }));
    return;
  }

  // GET/PUT /soul — read/write SOUL.md
  const dataDir = process.env.AGENT_DATA_DIR || join(__dirname, "data");
  if (req.url === "/soul") {
    if (req.method === "GET") {
      try {
        const content = await readFile(join(dataDir, "SOUL.md"), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: "" }));
      }
      return;
    }
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { content } = JSON.parse(body);
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "SOUL.md"), content, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "saved" }));
      return;
    }
  }

  // GET/PUT /cron — read/write CRON.md
  if (req.url === "/cron") {
    if (req.method === "GET") {
      try {
        const content = await readFile(join(dataDir, "CRON.md"), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: "" }));
      }
      return;
    }
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { content } = JSON.parse(body);
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "CRON.md"), content, "utf8");
      // Restart cron scheduler with new config
      startCronScheduler();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "saved" }));
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

// --- CRON Scheduler ---
// CRON.md format:
//   # every <interval> — <task description>
//   Intervals: 1m, 5m, 15m, 30m, 1h, 6h, 12h, 24h
//   Example:
//     # every 30m — Check server status and report
//     # every 6h — Summarize latest news about AI

let cronTimers = [];

function parseInterval(str) {
  const match = str.match(/^(\d+)(m|h)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

function parseCronMd(content) {
  if (!content) return [];
  const tasks = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^#\s*every\s+(\S+)\s*[—–-]\s*(.+)$/i);
    if (match) {
      const interval = parseInterval(match[1].trim());
      const task = match[2].trim();
      if (interval && task) {
        tasks.push({ interval, task });
      }
    }
  }
  return tasks;
}

async function executeCronTask(task) {
  console.log(`[Agent ${AGENT_NAME}] [CRON] Executing: ${task}`);
  try {
    const res = await fetch(`http://localhost:${process.env.AGENT_PORT || 3000}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `[Scheduled Task] ${task}` }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[Agent ${AGENT_NAME}] [CRON] Result: ${data.reply?.slice(0, 100)}...`);
    }
  } catch (err) {
    console.error(`[Agent ${AGENT_NAME}] [CRON] Error:`, err.message);
  }
}

async function startCronScheduler() {
  // Clear existing timers
  for (const timer of cronTimers) clearInterval(timer);
  cronTimers = [];

  const cronContent = await loadCron();
  if (!cronContent) return;

  const tasks = parseCronMd(cronContent);
  if (tasks.length === 0) return;

  console.log(`[Agent ${AGENT_NAME}] [CRON] Loaded ${tasks.length} scheduled task(s)`);
  for (const { interval, task } of tasks) {
    console.log(`[Agent ${AGENT_NAME}] [CRON]   every ${interval / 60000}m — ${task}`);
    const timer = setInterval(() => executeCronTask(task), interval);
    cronTimers.push(timer);
  }
}

// --- Startup ---
await loadSkills();

const PORT = process.env.AGENT_PORT || 3000;
server.listen(PORT, "0.0.0.0", async () => {
  console.log(`[Agent ${AGENT_NAME}] Listening on port ${PORT}`);
  console.log(`  Skills: ${loadedSkills.size > 0 ? Array.from(loadedSkills.keys()).join(", ") : "none"}`);
  console.log(`  Tools: ${allTools.length > 0 ? allTools.map((t) => t.name).join(", ") : "none"}`);

  const soul = await loadSoul();
  console.log(`  SOUL.md: ${soul ? "loaded" : "not set"}`);

  await startCronScheduler();
});

process.on("SIGTERM", () => {
  console.log(`[Agent ${AGENT_NAME}] Shutting down...`);
  for (const timer of cronTimers) clearInterval(timer);
  server.close();
  process.exit(0);
});
