import { Bot } from "grammy";
import type { Channel, MessageHandler } from "./types.js";

export class TelegramChannel implements Channel {
  name = "telegram";
  private bot: Bot | null = null;
  private handler: MessageHandler | null = null;

  async connect(config: Record<string, string>): Promise<void> {
    const { botToken } = config;

    if (!botToken) {
      throw new Error(
        "Telegram requires botToken. " +
        "Set TELEGRAM_BOT_TOKEN env var, or pass --telegram-bot-token.",
      );
    }

    this.bot = new Bot(botToken);

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

    this.bot.start();
    console.log(`[Telegram] Bot started (polling)`);
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
}
