import { randomUUID } from "node:crypto";
import type { Agent, AgentConfig } from "./types.js";
import { ContainerRuntime } from "./container.js";

export class AgentManager {
  private agents = new Map<string, Agent>();
  private runtime: ContainerRuntime;

  constructor() {
    this.runtime = new ContainerRuntime();
  }

  async create(config: AgentConfig): Promise<Agent> {
    const agent: Agent = {
      id: randomUUID(),
      name: config.name,
      config,
      status: "created",
      createdAt: new Date(),
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async start(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const container = await this.runtime.createContainer(
      agent.id,
      "claw-agent:latest",
    );
    agent.containerId = container.id;
    await this.runtime.startContainer(container.id);
    agent.status = "running";
  }

  async stop(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent?.containerId) throw new Error(`Agent ${agentId} not found or not running`);

    await this.runtime.stopContainer(agent.containerId);
    agent.status = "stopped";
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }
}
