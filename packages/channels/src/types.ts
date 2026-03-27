export interface ChannelMessage {
  from: string;
  channel: string;
  text: string;
  timestamp: Date;
}

export type MessageHandler = (message: ChannelMessage) => Promise<string | null>;

export interface Channel {
  name: string;
  connect(config: Record<string, string | undefined>): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(channel: string, text: string): Promise<void>;
}
