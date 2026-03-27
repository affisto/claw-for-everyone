#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("affisto")
  .description("AI Worker Platform — Assign 24/7 AI agents to your channels")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Affisto: check Docker, set up database")
  .action(async () => {
    console.log("Initializing Affisto...");
    // TODO: Check Docker, initialize DB
    console.log("Done! Affisto is ready.");
  });

program
  .command("create <name>")
  .description("Create a new AI agent")
  .option("--llm <provider>", "LLM provider (claude|openai|gemini|ollama)", "claude")
  .option("--model <model>", "LLM model name")
  .action(async (name: string, opts: { llm: string; model?: string }) => {
    console.log(`Creating agent "${name}" with ${opts.llm}...`);
    // TODO: Create agent via runtime
    console.log(`Agent "${name}" created!`);
  });

program
  .command("teach <name> <file>")
  .description("Teach an agent with knowledge file")
  .action(async (name: string, file: string) => {
    console.log(`Teaching agent "${name}" from ${file}...`);
    // TODO: Upload knowledge to agent
    console.log("Done!");
  });

program
  .command("skill")
  .description("Manage agent skills")
  .command("install <skill>")
  .option("--agent <name>", "Target agent name")
  .description("Install a skill to an agent")
  .action(async (skill: string, opts: { agent?: string }) => {
    console.log(`Installing skill "${skill}" to agent "${opts.agent}"...`);
    // TODO: Install skill
    console.log("Done!");
  });

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

program
  .command("list")
  .description("List all agents")
  .action(async () => {
    console.log("Agents:");
    // TODO: List agents from DB
    console.log("  (none yet)");
  });

program
  .command("web")
  .description("Start the admin web console")
  .option("-p, --port <port>", "Port number", "3000")
  .action(async (opts: { port: string }) => {
    console.log(`Starting admin console on http://localhost:${opts.port}...`);
    // TODO: Start Next.js dev server
  });

program.parse();
