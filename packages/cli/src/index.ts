#!/usr/bin/env node
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { createDb, migrate, agents } from "@claw/shared-db";
import { eq } from "drizzle-orm";
import { getDbPath } from "./config.js";

function initDb() {
  const db = createDb(getDbPath());
  migrate();
  return db;
}

const program = new Command();

program
  .name("affisto")
  .description("AI Worker Platform — Assign 24/7 AI agents to your channels")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize Affisto: check Docker, set up database")
  .action(async () => {
    console.log("Initializing Affisto...\n");

    // Check Docker
    console.log("Checking Docker...");
    try {
      const version = execSync("docker version --format '{{.Server.Version}}'", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      console.log(`  Docker ${version} found\n`);
    } catch {
      console.error("  Docker is not running. Please start Docker Desktop and try again.");
      process.exit(1);
    }

    // Init DB
    console.log("Setting up database...");
    initDb();
    console.log(`  Database created at ${getDbPath()}\n`);

    // Build agent image
    console.log("Building agent Docker image...");
    try {
      execSync("docker build -t claw-agent:latest packages/runtime/agent", {
        encoding: "utf-8",
        stdio: "inherit",
      });
      console.log("  Agent image built\n");
    } catch {
      console.log("  Skipped (Dockerfile not found or build failed). You can build it later.\n");
    }

    console.log("Done! Affisto is ready.");
    console.log("  Run: pnpm af create <name> --llm claude");
  });

// --- create ---
program
  .command("create <name>")
  .description("Create a new AI agent")
  .option("--llm <provider>", "LLM provider (claude|openai|gemini|ollama)", "claude")
  .option("--model <model>", "LLM model name")
  .option("--api-key <key>", "LLM API key (or set ANTHROPIC_API_KEY env var)")
  .action(async (name: string, opts: { llm: string; model?: string; apiKey?: string }) => {
    const db = initDb();

    // Check if agent already exists
    const existing = db.select().from(agents).where(eq(agents.name, name)).get();
    if (existing) {
      console.error(`Agent "${name}" already exists.`);
      process.exit(1);
    }

    const id = randomUUID();
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || "";
    const model = opts.model || (opts.llm === "claude" ? "claude-sonnet-4-20250514" : undefined);

    db.insert(agents).values({
      id,
      name,
      llmProvider: opts.llm,
      llmModel: model,
      llmApiKey: apiKey,
      skills: "[]",
      status: "created",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    console.log(`Agent "${name}" created!`);
    console.log(`  ID: ${id}`);
    console.log(`  LLM: ${opts.llm}${model ? ` (${model})` : ""}`);
    console.log(`  Status: created`);

    // Assign a port (base 4100 + count of existing agents)
    const existingCount = db.select().from(agents).all().length;
    const agentPort = 4100 + existingCount - 1; // -1 because we just inserted

    // Try to start container
    try {
      const containerId = execSync(
        `docker create --name claw-agent-${id.slice(0, 8)} ` +
        `--label claw.agent.id=${id} ` +
        `--label claw.agent.name=${name} ` +
        `-e AGENT_ID=${id} ` +
        `-e AGENT_NAME=${name} ` +
        `-e LLM_PROVIDER=${opts.llm} ` +
        `-e LLM_MODEL=${model || ""} ` +
        `-e LLM_API_KEY=${apiKey} ` +
        `-p ${agentPort}:3000 ` +
        `--memory=512m ` +
        `claw-agent:latest`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      db.update(agents)
        .set({ containerId, status: "created", updatedAt: new Date() })
        .where(eq(agents.id, id))
        .run();

      console.log(`  Container: ${containerId.slice(0, 12)}`);
      console.log(`\n  Start with: pnpm af start ${name}`);
    } catch {
      console.log("\n  Note: claw-agent image not found. Run 'pnpm af init' first to build it.");
    }
  });

// --- start ---
program
  .command("start <name>")
  .description("Start an agent's container")
  .action(async (name: string) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, name)).get();
    if (!agent) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }
    if (!agent.containerId) {
      console.error(`Agent "${name}" has no container. Recreate it with 'pnpm af create'.`);
      process.exit(1);
    }

    try {
      execSync(`docker start ${agent.containerId}`, { stdio: "inherit" });
      db.update(agents)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .run();
      console.log(`Agent "${name}" started.`);
    } catch {
      console.error(`Failed to start agent "${name}".`);
      process.exit(1);
    }
  });

// --- stop ---
program
  .command("stop <name>")
  .description("Stop an agent's container")
  .action(async (name: string) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, name)).get();
    if (!agent) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }
    if (!agent.containerId) {
      console.error(`Agent "${name}" has no container.`);
      process.exit(1);
    }

    try {
      execSync(`docker stop ${agent.containerId}`, { stdio: "inherit" });
      db.update(agents)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .run();
      console.log(`Agent "${name}" stopped.`);
    } catch {
      console.error(`Failed to stop agent "${name}".`);
      process.exit(1);
    }
  });

// --- list ---
program
  .command("list")
  .description("List all agents")
  .action(async () => {
    const db = initDb();
    const allAgents = db.select().from(agents).all();

    if (allAgents.length === 0) {
      console.log("No agents yet. Create one with: pnpm af create <name> --llm claude");
      return;
    }

    console.log("Agents:\n");
    console.log(
      "  " +
      "NAME".padEnd(20) +
      "LLM".padEnd(12) +
      "STATUS".padEnd(12) +
      "CONTAINER".padEnd(14) +
      "CREATED"
    );
    console.log("  " + "-".repeat(70));

    for (const a of allAgents) {
      // Sync status with Docker if container exists
      let status = a.status;
      if (a.containerId) {
        try {
          const state = execSync(
            `docker inspect --format '{{.State.Status}}' ${a.containerId}`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim();
          status = state;
          if (status !== a.status) {
            db.update(agents)
              .set({ status, updatedAt: new Date() })
              .where(eq(agents.id, a.id))
              .run();
          }
        } catch {
          status = "no-container";
        }
      }

      const created = a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "?";
      console.log(
        "  " +
        a.name.padEnd(20) +
        a.llmProvider.padEnd(12) +
        status.padEnd(12) +
        (a.containerId?.slice(0, 12) || "-").padEnd(14) +
        created
      );
    }
  });

// --- rm ---
program
  .command("rm <name>")
  .description("Remove an agent and its container")
  .action(async (name: string) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, name)).get();
    if (!agent) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }

    if (agent.containerId) {
      try {
        execSync(`docker rm -f ${agent.containerId}`, { stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        // container might not exist
      }
    }

    db.delete(agents).where(eq(agents.id, agent.id)).run();
    console.log(`Agent "${name}" removed.`);
  });

// --- teach ---
program
  .command("teach <name> <file>")
  .description("Teach an agent with knowledge file")
  .action(async (name: string, file: string) => {
    console.log(`Teaching agent "${name}" from ${file}...`);
    // TODO: Upload knowledge to agent container
    console.log("Done!");
  });

// --- invite ---
program
  .command("invite <name>")
  .description("Invite an agent to a channel")
  .option("--slack <channel>", "Slack channel")
  .option("--telegram <chat>", "Telegram chat")
  .option("--discord <channel>", "Discord channel")
  .action(async (name: string, opts: { slack?: string; telegram?: string; discord?: string }) => {
    const channel = opts.slack || opts.telegram || opts.discord;
    console.log(`Inviting agent "${name}" to ${channel}...`);
    // TODO: Connect agent to channel
    console.log("Done!");
  });

// --- web ---
program
  .command("web")
  .description("Start the admin web console")
  .option("-p, --port <port>", "Port number", "3000")
  .action(async (opts: { port: string }) => {
    console.log(`Starting admin console on http://localhost:${opts.port}...`);
    // TODO: Start Next.js dev server
  });

program.parse();
