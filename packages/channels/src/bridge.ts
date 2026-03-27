import { SlackChannel } from "./slack.js";
import type { Channel, ChannelMessage } from "./types.js";

interface AgentBinding {
  agentName: string;
  agentPort: number;
  channel: Channel;
}

export class ChannelBridge {
  private bindings: AgentBinding[] = [];

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
    for (const binding of this.bindings) {
      await binding.channel.disconnect();
    }
    this.bindings = [];
  }
}
