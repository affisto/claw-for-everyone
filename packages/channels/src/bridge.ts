import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SlackChannel } from "./slack.js";
import { TelegramChannel, type TelegramConnectConfig } from "./telegram.js";
import type { Channel, ChannelMessage } from "./types.js";

interface AgentBinding {
  agentName: string;
  agentPort: number;
  channel: Channel;
}

export class ChannelBridge {
  private bindings: AgentBinding[] = [];
  private telegramWebhookHandlers = new Map<string, TelegramChannel>();
  private telegramWebhookServer: ReturnType<typeof createServer> | null = null;

  async connectSlack(
    agentName: string,
    agentPort: number,
    config: { botToken: string; appToken: string; signingSecret?: string },
  ): Promise<void> {
    const slack = new SlackChannel();

    slack.onMessage(async (msg: ChannelMessage) => {
      return this.forwardToAgent(agentName, agentPort, msg.text);
    });

    await slack.connect(config);

    this.bindings.push({ agentName, agentPort, channel: slack });
    console.log(`[Bridge] Agent "${agentName}" connected to Slack (port ${agentPort})`);
  }

  async connectTelegram(
    agentName: string,
    agentPort: number,
    config: TelegramConnectConfig,
  ): Promise<void> {
    const telegram = new TelegramChannel();

    telegram.onMessage(async (msg: ChannelMessage) => {
      return this.forwardToAgent(agentName, agentPort, msg.text);
    });

    await telegram.connect(config);

    if (telegram.usesWebhook()) {
      const webhookPath = telegram.getWebhookPath();
      if (!webhookPath) throw new Error("Webhook path missing for Telegram channel");
      this.telegramWebhookHandlers.set(webhookPath, telegram);
    }

    this.bindings.push({ agentName, agentPort, channel: telegram });
    console.log(`[Bridge] Agent "${agentName}" connected to Telegram (port ${agentPort})`);
  }

  async startTelegramWebhookServer(port: number): Promise<void> {
    if (this.telegramWebhookHandlers.size === 0 || this.telegramWebhookServer) return;

    this.telegramWebhookServer = createServer(async (req, res) => {
      await this.handleTelegramWebhook(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.telegramWebhookServer?.once("error", reject);
      this.telegramWebhookServer?.listen(port, () => {
        this.telegramWebhookServer?.off("error", reject);
        resolve();
      });
    });

    console.log(`[Bridge] Telegram webhook server listening on port ${port}`);
  }

  private async forwardToAgent(
    agentName: string,
    agentPort: number,
    message: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`http://localhost:${agentPort}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[Bridge] Agent "${agentName}" error: ${err}`);
        return `Sorry, I encountered an error processing your message.`;
      }

      const data = (await res.json()) as { reply: string };
      return data.reply;
    } catch (err) {
      console.error(`[Bridge] Cannot reach agent "${agentName}" on port ${agentPort}:`, err);
      return `Sorry, agent "${agentName}" is not responding. Is it running?`;
    }
  }

  async disconnectAll(): Promise<void> {
    if (this.telegramWebhookServer) {
      await new Promise<void>((resolve, reject) => {
        this.telegramWebhookServer?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      this.telegramWebhookServer = null;
      this.telegramWebhookHandlers.clear();
    }

    for (const binding of this.bindings) {
      await binding.channel.disconnect();
    }
    this.bindings = [];
  }

  private async handleTelegramWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url || "/";
    const telegram = this.telegramWebhookHandlers.get(path);
    if (!telegram) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const handled = await telegram.handleWebhook(req, res);
    if (!handled) {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
    }
  }
}
