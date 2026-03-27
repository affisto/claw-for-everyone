import type { IncomingMessage, ServerResponse } from "node:http";
import { Bot } from "grammy";
import type { Channel, MessageHandler } from "./types.js";

export interface TelegramConnectConfig {
  [key: string]: string | undefined;
  botToken: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  webhookPath?: string;
  webhookSecretToken?: string;
}

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot | null = null;
  private handler: MessageHandler | null = null;
  private mode: "polling" | "webhook" = "polling";
  private webhookPath: string | null = null;
  private webhookSecretToken: string | null = null;

  async connect(config: Record<string, string | undefined>): Promise<void> {
    const { botToken } = config;

    if (!botToken) {
      throw new Error(
        "Telegram requires botToken. " +
        "Set TELEGRAM_BOT_TOKEN env var, or pass --telegram-bot-token.",
      );
    }

    this.bot = new Bot(botToken);
    this.mode = config.mode === "webhook" ? "webhook" : "polling";
    this.webhookPath = config.webhookPath || null;
    this.webhookSecretToken = config.webhookSecretToken || null;

    this.bot.on("message:text", async (ctx) => {
      if (!this.handler) return;

      const channelMessage = {
        from: ctx.from?.username || ctx.from?.first_name || String(ctx.from?.id ?? "unknown"),
        channel: String(ctx.chat.id),
        text: ctx.message.text,
        timestamp: new Date(),
      };

      const reply = await this.handler(channelMessage);
      if (reply) {
        await ctx.reply(reply);
      }
    });

    if (this.mode === "webhook") {
      if (!config.webhookUrl || !this.webhookPath) {
        throw new Error("Telegram webhook mode requires webhookUrl and webhookPath");
      }

      await this.bot.api.setWebhook(config.webhookUrl, {
        secret_token: this.webhookSecretToken || undefined,
      });
      console.log(`[Telegram] Bot started (webhook: ${config.webhookUrl})`);
      return;
    }

    await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    this.bot.start();
    console.log("[Telegram] Bot started (polling)");
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      console.log("[Telegram] Bot stopped");
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    await this.bot.api.sendMessage(chatId, text);
  }

  usesWebhook(): boolean {
    return this.mode === "webhook";
  }

  getWebhookPath(): string | null {
    return this.webhookPath;
  }

  async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!this.bot || !this.usesWebhook() || !this.webhookPath) return false;
    if (req.method !== "POST" || req.url !== this.webhookPath) return false;

    if (
      this.webhookSecretToken &&
      req.headers["x-telegram-bot-api-secret-token"] !== this.webhookSecretToken
    ) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Invalid webhook secret");
      return true;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const update = JSON.parse(body);
      await this.bot.handleUpdate(update);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook handling failed";
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(message);
    }

    return true;
  }
}
