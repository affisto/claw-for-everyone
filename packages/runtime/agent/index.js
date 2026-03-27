#!/usr/bin/env node

const AGENT_ID = process.env.AGENT_ID;
const AGENT_NAME = process.env.AGENT_NAME || "unnamed";
const LLM_PROVIDER = process.env.LLM_PROVIDER || "claude";
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-20250514";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const HOST_URL = process.env.HOST_URL || "http://host.docker.internal:4000";

console.log(`[Agent ${AGENT_NAME}] Starting...`);
console.log(`  ID: ${AGENT_ID}`);
console.log(`  LLM: ${LLM_PROVIDER} (${LLM_MODEL})`);
console.log(`  Host: ${HOST_URL}`);

async function chatClaude(messages) {
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// Simple HTTP server to receive messages from the host
import { createServer } from "node:http";

const conversationHistory = [];
const systemPrompt = `You are ${AGENT_NAME}, an AI agent running in a container. You are helpful, concise, and friendly. Respond to messages sent to you.`;

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", agent: AGENT_NAME, id: AGENT_ID }));
    return;
  }

  // Chat endpoint
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { message } = JSON.parse(body);
      console.log(`[Agent ${AGENT_NAME}] Received: ${message}`);

      conversationHistory.push({ role: "user", content: message });

      const messages = [
        { role: "system", content: systemPrompt },
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

  // Reset conversation
  if (req.method === "POST" && req.url === "/reset") {
    conversationHistory.length = 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "conversation reset" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const PORT = process.env.AGENT_PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Agent ${AGENT_NAME}] Listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log(`[Agent ${AGENT_NAME}] Shutting down...`);
  server.close();
  process.exit(0);
});
