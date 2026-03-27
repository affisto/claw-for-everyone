#!/usr/bin/env node
import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENT_ID = process.env.AGENT_ID;
const AGENT_NAME = process.env.AGENT_NAME || "unnamed";
const LLM_PROVIDER = process.env.LLM_PROVIDER || "claude";
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-20250514";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const HOST_URL = process.env.HOST_URL || "http://host.docker.internal:3000";
const AGENT_SKILLS = (process.env.AGENT_SKILLS || "").split(",").filter(Boolean);

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

// --- Claude API with Tool Use ---
async function chatClaude(messages) {
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model: LLM_MODEL,
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
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
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
        model: LLM_MODEL,
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

// --- HTTP Server ---
const conversationHistory = [];

function getSystemPrompt() {
  let prompt = `You are ${AGENT_NAME}, an AI agent running in a container. You are helpful, concise, and friendly.`;

  if (allTools.length > 0) {
    const skillNames = Array.from(loadedSkills.values())
      .map((s) => s.manifest?.name)
      .filter(Boolean);
    prompt += `\n\nYou have the following skills installed: ${skillNames.join(", ")}.`;
    prompt += `\nUse the available tools when appropriate to fulfill user requests.`;
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
        { role: "system", content: getSystemPrompt() },
        ...conversationHistory,
      ];

      let reply;
      if (LLM_PROVIDER === "claude") {
        reply = await chatClaude(messages);
      } else {
        reply = `[${LLM_PROVIDER} not yet implemented] Echo: ${message}`;
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

  res.writeHead(404);
  res.end("Not found");
});

// --- Startup ---
await loadSkills();

const PORT = process.env.AGENT_PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Agent ${AGENT_NAME}] Listening on port ${PORT}`);
  console.log(`  Skills: ${loadedSkills.size > 0 ? Array.from(loadedSkills.keys()).join(", ") : "none"}`);
  console.log(`  Tools: ${allTools.length > 0 ? allTools.map((t) => t.name).join(", ") : "none"}`);
});

process.on("SIGTERM", () => {
  console.log(`[Agent ${AGENT_NAME}] Shutting down...`);
  server.close();
  process.exit(0);
});
