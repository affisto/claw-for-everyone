import Docker from "dockerode";

export class ContainerRuntime {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async createContainer(agentId: string, image: string) {
    const container = await this.docker.createContainer({
      Image: image,
      name: `claw-agent-${agentId}`,
      Labels: { "claw.agent.id": agentId },
      HostConfig: {
        NetworkMode: "bridge",
        Memory: 512 * 1024 * 1024, // 512MB
        CpuShares: 256,
      },
    });
    return container;
  }

  async startContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  async stopContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.stop();
  }

  async removeContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.remove({ force: true });
  }

  async listAgentContainers() {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ["claw.agent.id"] },
    });
    return containers;
  }
}
