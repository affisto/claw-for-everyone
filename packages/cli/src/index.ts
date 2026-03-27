#!/usr/bin/env node
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createDb, migrate, agents, channelConfigs } from "@claw/shared-db";
import { ChannelBridge } from "@claw/channels";
import { eq } from "drizzle-orm";
import { getAgentDir, getDbPath } from "./config.js";

function initDb() {
  const db = createDb(getDbPath());
  migrate();
  return db;
}

const SUPPORTED_LLM_PROVIDERS = ["claude", "openai", "gemini", "ollama", "lmstudio"] as const;
type SupportedLLMProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

const DEFAULT_MODELS: Record<SupportedLLMProvider, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
  lmstudio: "openai/gpt-oss-20b",
};

function isSupportedLLMProvider(provider: string): provider is SupportedLLMProvider {
  return SUPPORTED_LLM_PROVIDERS.includes(provider as SupportedLLMProvider);
}

function getDefaultModel(provider: SupportedLLMProvider): string {
  return DEFAULT_MODELS[provider];
}

function getProviderApiKey(provider: SupportedLLMProvider, explicitApiKey?: string): string {
  if (explicitApiKey) return explicitApiKey;

  switch (provider) {
    case "claude":
      return process.env.ANTHROPIC_API_KEY || "";
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    case "gemini":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    case "ollama":
      return "";
    case "lmstudio":
      return process.env.LMSTUDIO_API_KEY || "";
  }
}

function getProviderBaseUrl(provider: SupportedLLMProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_BASE_URL || "";
    case "ollama":
      return process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
    case "lmstudio":
      return process.env.LMSTUDIO_BASE_URL || "http://host.docker.internal:1234";
    default:
      return "";
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
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
  .option("--llm <provider>", "LLM provider (claude|openai|gemini|ollama|lmstudio)", "claude")
  .option("--model <model>", "LLM model name")
  .option(
    "--api-key <key>",
    "LLM API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / GOOGLE_API_KEY / LMSTUDIO_API_KEY)",
  )
  .action(async (name: string, opts: { llm: string; model?: string; apiKey?: string }) => {
    const db = initDb();

    if (!isSupportedLLMProvider(opts.llm)) {
      console.error(`Unsupported LLM provider "${opts.llm}".`);
      console.error(`  Supported: ${SUPPORTED_LLM_PROVIDERS.join(", ")}`);
      process.exit(1);
    }

    // Check if agent already exists
    const existing = db.select().from(agents).where(eq(agents.name, name)).get();
    if (existing) {
      console.error(`Agent "${name}" already exists.`);
      process.exit(1);
    }

    const id = randomUUID();
    const provider = opts.llm;
    const apiKey = getProviderApiKey(provider, opts.apiKey);
    const model = opts.model || getDefaultModel(provider);
    const baseUrl = getProviderBaseUrl(provider);

    db.insert(agents).values({
      id,
      name,
      llmProvider: provider,
      llmModel: model,
      llmApiKey: apiKey,
      skills: "[]",
      status: "created",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    console.log(`Agent "${name}" created!`);
    console.log(`  ID: ${id}`);
    console.log(`  LLM: ${provider}${model ? ` (${model})` : ""}`);
    console.log(`  Status: created`);

    // Assign a port (base 4100 + count of existing agents)
    const existingCount = db.select().from(agents).all().length;
    const agentPort = 4100 + existingCount - 1; // -1 because we just inserted

    // Try to start container
    try {
      const agentDir = getAgentDir(id);
      const containerId = execSync(
        `docker create --name claw-agent-${id.slice(0, 8)} ` +
        `--label claw.agent.id=${id} ` +
        `--label claw.agent.name=${name} ` +
        `-e AGENT_ID=${id} ` +
        `-e AGENT_NAME=${name} ` +
        `-e LLM_PROVIDER=${provider} ` +
        `-e LLM_MODEL=${model || ""} ` +
        `-e LLM_API_KEY=${apiKey} ` +
        `-e LLM_BASE_URL=${baseUrl} ` +
        `-e HOST_URL=http://host.docker.internal:3000 ` +
        `-e BRAVE_SEARCH_API_KEY=${process.env.BRAVE_SEARCH_API_KEY || ""} ` +
        `-e AGENT_SKILLS=${JSON.parse(db.select().from(agents).where(eq(agents.id, id)).get()?.skills || "[]").join(",")} ` +
        `-e AGENT_DATA_DIR=/app/data ` +
        `-v "${agentDir}:/app/data" ` +
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

// --- skill install ---
program
  .command("skill:install <skill> <agentName>")
  .description("Install a skill to an agent")
  .action(async (skill: string, agentName: string) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, agentName)).get();
    if (!agent) {
      console.error(`Agent "${agentName}" not found.`);
      process.exit(1);
    }

    const currentSkills = JSON.parse(agent.skills || "[]") as string[];
    if (currentSkills.includes(skill)) {
      console.log(`Skill "${skill}" is already installed on agent "${agentName}".`);
      return;
    }

    currentSkills.push(skill);
    db.update(agents)
      .set({ skills: JSON.stringify(currentSkills), updatedAt: new Date() })
      .where(eq(agents.id, agent.id))
      .run();

    // If agent has a container, update AGENT_SKILLS env and recreate
    if (agent.containerId) {
      console.log(`Skill "${skill}" installed. Recreate the container to apply:`);
      console.log(`  pnpm -w af rm ${agentName} && pnpm -w af create ${agentName} --llm ${agent.llmProvider}`);
    } else {
      console.log(`Skill "${skill}" installed on agent "${agentName}".`);
    }
  });

// --- skill list ---
program
  .command("skill:list [agentName]")
  .description("List available skills or skills installed on an agent")
  .action(async (agentName?: string) => {
    if (agentName) {
      const db = initDb();
      const agent = db.select().from(agents).where(eq(agents.name, agentName)).get();
      if (!agent) {
        console.error(`Agent "${agentName}" not found.`);
        process.exit(1);
      }
      const skills = JSON.parse(agent.skills || "[]") as string[];
      console.log(`Skills installed on "${agentName}":`);
      if (skills.length === 0) {
        console.log("  (none)");
      } else {
        for (const s of skills) console.log(`  - ${s}`);
      }
    } else {
      console.log("Available built-in skills:\n");
      console.log("  web-page      Create and update web pages served at /p/<slug>");
      console.log("  web-search    Search the web and fetch URLs (requires BRAVE_SEARCH_API_KEY)");
      console.log("\nInstall with: pnpm -w af skill:install <skill> <agent>");
    }
  });

// --- teach ---
program
  .command("teach <name> <file>")
  .description("Teach an agent with knowledge file")
  .action(async (name: string, file: string) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, name)).get();
    if (!agent) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }

    if (!existsSync(file) || !statSync(file).isFile()) {
      console.error(`Knowledge file "${file}" not found.`);
      process.exit(1);
    }

    const knowledgeDir = join(getAgentDir(agent.id), "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });

    const targetPath = join(knowledgeDir, basename(file));
    copyFileSync(file, targetPath);

    console.log(`Knowledge copied for agent "${name}".`);
    console.log(`  Stored at: ${targetPath}`);
    if (agent.containerId) {
      console.log("  Available immediately to newly created containers and mounted runtimes.");
      console.log("  Recreate the container if this agent was created before knowledge mounts were added.");
    }
  });

// --- invite ---
program
  .command("invite <name>")
  .description("Invite an agent to a channel (Slack or Telegram)")
  .option("--slack <channel>", "Slack channel name or ID")
  .option("--slack-bot-token <token>", "Slack Bot Token (or SLACK_BOT_TOKEN env)")
  .option("--slack-app-token <token>", "Slack App Token (or SLACK_APP_TOKEN env)")
  .option("--telegram", "Connect to Telegram")
  .option("--telegram-bot-token <token>", "Telegram Bot Token (or TELEGRAM_BOT_TOKEN env)")
  .option("--telegram-mode <mode>", "Telegram mode (polling|webhook)", "polling")
  .option("--telegram-webhook-base-url <url>", "Public HTTPS base URL for Telegram webhooks")
  .action(async (name: string, opts: {
    slack?: string; slackBotToken?: string; slackAppToken?: string;
    telegram?: boolean; telegramBotToken?: string;
    telegramMode?: string; telegramWebhookBaseUrl?: string;
  }) => {
    const db = initDb();
    const agent = db.select().from(agents).where(eq(agents.name, name)).get();
    if (!agent) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }

    if (opts.telegram) {
      const botToken = opts.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || "";
      const mode = opts.telegramMode === "webhook" ? "webhook" : "polling";
      if (!botToken) {
        console.error("Telegram requires a bot token.");
        console.error("  Set TELEGRAM_BOT_TOKEN env var, or pass --telegram-bot-token.");
        process.exit(1);
      }

      if (opts.telegramMode && !["polling", "webhook"].includes(opts.telegramMode)) {
        console.error(`Unsupported Telegram mode "${opts.telegramMode}". Use polling or webhook.`);
        process.exit(1);
      }

      if (mode === "webhook" && !opts.telegramWebhookBaseUrl) {
        console.error("Telegram webhook mode requires --telegram-webhook-base-url.");
        process.exit(1);
      }

      const id = randomUUID();
      const webhookPath = `/telegram/${id}`;
      const webhookSecretToken = randomUUID();
      db.insert(channelConfigs).values({
        id,
        agentId: agent.id,
        channelType: "telegram",
        config: JSON.stringify({
          botToken,
          mode,
          webhookPath,
          webhookSecretToken,
          webhookBaseUrl: opts.telegramWebhookBaseUrl
            ? normalizeBaseUrl(opts.telegramWebhookBaseUrl)
            : "",
        }),
        active: 1,
        createdAt: new Date(),
      }).run();

      console.log(`Agent "${name}" connected to Telegram (${mode}).`);
      if (mode === "webhook") {
        console.log(`  Public webhook URL: ${normalizeBaseUrl(opts.telegramWebhookBaseUrl || "")}${webhookPath}`);
      }
      console.log("  Start the bridge with: pnpm -w af bridge");
      return;
    }

    if (opts.slack) {
      const botToken = opts.slackBotToken || process.env.SLACK_BOT_TOKEN || "";
      const appToken = opts.slackAppToken || process.env.SLACK_APP_TOKEN || "";

      if (!botToken || !appToken) {
        console.error("Slack requires bot token and app token.");
        console.error("  Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN env vars,");
        console.error("  or pass --slack-bot-token and --slack-app-token.");
        process.exit(1);
      }

      const id = randomUUID();
      db.insert(channelConfigs).values({
        id,
        agentId: agent.id,
        channelType: "slack",
        config: JSON.stringify({ botToken, appToken, channel: opts.slack }),
        active: 1,
        createdAt: new Date(),
      }).run();

      console.log(`Agent "${name}" invited to Slack channel "${opts.slack}".`);
      console.log(`  Start the bridge with: pnpm -w af bridge`);
      return;
    }

    console.error("Please specify a channel: --slack <channel> or --telegram");
    process.exit(1);
  });

// --- bridge ---
program
  .command("bridge")
  .description("Start the channel bridge (connects agents to Slack/Telegram/Discord)")
  .option("--telegram-webhook-port <port>", "Local port for Telegram webhook server", "8787")
  .action(async (opts: { telegramWebhookPort: string }) => {
    const db = initDb();
    const bridge = new ChannelBridge();

    const configs = db.select().from(channelConfigs).where(eq(channelConfigs.active, 1)).all();

    if (configs.length === 0) {
      console.log("No channel configs found. Use 'pnpm -w af invite <agent> --slack <channel>' first.");
      return;
    }

    for (const cfg of configs) {
      const agent = db.select().from(agents).where(eq(agents.id, cfg.agentId)).get();
      if (!agent) continue;

      const parsed = JSON.parse(cfg.config) as Record<string, string>;

      // Find agent port from container
      let agentPort = 4100;
      if (agent.containerId) {
        try {
          const portInfo = execSync(
            `docker port ${agent.containerId} 3000`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim();
          const match = portInfo.match(/:(\d+)$/);
          if (match) agentPort = parseInt(match[1], 10);
        } catch {
          console.error(`  Cannot find port for agent "${agent.name}". Is it running?`);
          continue;
        }
      }

      if (cfg.channelType === "slack") {
        console.log(`Connecting agent "${agent.name}" to Slack...`);
        await bridge.connectSlack(agent.name, agentPort, {
          botToken: parsed.botToken,
          appToken: parsed.appToken,
        });
      } else if (cfg.channelType === "telegram") {
        console.log(`Connecting agent "${agent.name}" to Telegram...`);
        const webhookPath = parsed.webhookPath || `/telegram/${cfg.id}`;
        const webhookUrl = parsed.mode === "webhook" && parsed.webhookBaseUrl
          ? `${normalizeBaseUrl(parsed.webhookBaseUrl)}${webhookPath}`
          : undefined;
        await bridge.connectTelegram(agent.name, agentPort, {
          botToken: parsed.botToken,
          mode: parsed.mode === "webhook" ? "webhook" : "polling",
          webhookPath,
          webhookUrl,
          webhookSecretToken: parsed.webhookSecretToken,
        });
      }
    }

    await bridge.startTelegramWebhookServer(Number.parseInt(opts.telegramWebhookPort, 10));

    console.log("\nBridge is running. Press Ctrl+C to stop.");

    // Keep process alive
    process.on("SIGINT", async () => {
      console.log("\nShutting down bridge...");
      await bridge.disconnectAll();
      process.exit(0);
    });
  });

// --- web ---
program
  .command("web")
  .description("Start the admin web console")
  .option("-p, --port <port>", "Port number", "3000")
  .option("--docker", "Start via docker-compose")
  .action(async (opts: { port: string; docker?: boolean }) => {
    initDb(); // Ensure DB exists

    if (opts.docker) {
      // Check if already running
      try {
        const status = execSync(
          `docker compose ps web --format '{{.State}}'`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        if (status === "running") {
          const portInfo = execSync(
            `docker compose port web 3000`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim();
          console.log(`Web console is already running at http://${portInfo}`);
          console.log(`  Stop with: docker compose down`);
          return;
        }
      } catch {
        // Not running, proceed
      }

      // Check if port is in use
      try {
        execSync(`lsof -ti:${opts.port}`, { stdio: ["pipe", "pipe", "pipe"] });
        console.error(`Port ${opts.port} is already in use. Choose a different port with -p <port>`);
        process.exit(1);
      } catch {
        // Port is free, proceed
      }

      console.log("Starting with docker-compose...");
      execSync(`AFFISTO_PORT=${opts.port} docker compose up -d web`, { stdio: "inherit" });
      console.log(`\nAdmin console: http://localhost:${opts.port}`);
      return;
    }

    console.log(`Starting admin console on http://localhost:${opts.port}...`);
    const { spawn } = await import("node:child_process");
    const child = spawn("npx", ["next", "dev", "-p", opts.port], {
      cwd: new URL("../../web", import.meta.url).pathname,
      stdio: "inherit",
      env: { ...process.env, AFFISTO_DB_PATH: getDbPath() },
    });

    process.on("SIGINT", () => {
      child.kill("SIGINT");
      process.exit(0);
    });

    child.on("exit", (code) => process.exit(code ?? 0));
  });

program.parse();
