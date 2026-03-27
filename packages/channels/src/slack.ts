import { App } from "@slack/bolt";
import type { Channel, MessageHandler } from "./types.js";

export class SlackChannel implements Channel {
  name = "slack";
  private app: App | null = null;
  private handler: MessageHandler | null = null;

  async connect(config: Record<string, string>): Promise<void> {
    const { botToken, appToken, signingSecret } = config;

    if (!botToken || !appToken) {
      throw new Error(
        "Slack requires botToken and appToken. " +
        "Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN env vars, " +
        "or pass them via --slack-bot-token and --slack-app-token.",
      );
    }

    this.app = new App({
      token: botToken,
      signingSecret: signingSecret || undefined,
      appToken,
      socketMode: true,
    });

    // Listen to all messages in channels the bot is in
    this.app.message(async ({ message, say }) => {
      if (!this.handler) return;
      // Skip bot messages to avoid loops
      if ("bot_id" in message) return;
      if (!("text" in message) || !message.text) return;

      const channelMessage = {
        from: ("user" in message ? message.user : "unknown") as string,
        channel: ("channel" in message ? message.channel : "unknown") as string,
        text: message.text,
        timestamp: new Date(),
      };

      const reply = await this.handler(channelMessage);
      if (reply) {
        await say(reply);
      }
    });

    // Listen to app mentions (@bot)
    this.app.event("app_mention", async ({ event, say }) => {
      if (!this.handler) return;

      const channelMessage = {
        from: event.user ?? "unknown",
        channel: event.channel,
        text: event.text,
        timestamp: new Date(),
      };

      const reply = await this.handler(channelMessage);
      if (reply) {
        await say(reply);
      }
    });

    await this.app.start();
    console.log(`[Slack] Connected with Socket Mode`);
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
      console.log("[Slack] Disconnected");
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(channel: string, text: string): Promise<void> {
    if (!this.app) throw new Error("Slack not connected");
    await this.app.client.chat.postMessage({
      channel,
      text,
    });
  }
}
