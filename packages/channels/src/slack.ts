import type { Channel, MessageHandler } from "./types.js";

export class SlackChannel implements Channel {
  name = "slack";
  private handler: MessageHandler | null = null;

  async connect(_config: Record<string, string>): Promise<void> {
    // TODO: Initialize Slack Bolt app
    // const app = new App({ token: config.botToken, signingSecret: config.signingSecret });
    throw new Error("Slack channel not yet implemented");
  }

  async disconnect(): Promise<void> {
    // TODO: Disconnect Slack
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(_channel: string, _text: string): Promise<void> {
    // TODO: Send message via Slack API
    throw new Error("Slack channel not yet implemented");
  }
}
