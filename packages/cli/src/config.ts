import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AFFISTO_HOME = join(homedir(), ".affisto");

export function getDataDir(): string {
  mkdirSync(AFFISTO_HOME, { recursive: true });
  return AFFISTO_HOME;
}

export function getDbPath(): string {
  return join(getDataDir(), "claw.db");
}

export function getAgentDir(agentId: string): string {
  const dir = join(getDataDir(), "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
