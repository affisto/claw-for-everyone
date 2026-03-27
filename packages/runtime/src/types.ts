export type LLMProviderType = "claude" | "openai" | "gemini" | "ollama" | "lmstudio";

export interface LLMProvider {
  type: LLMProviderType;
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
  model?: string;
}

export interface AgentConfig {
  name: string;
  llm: LLMProvider;
  skills: string[];
  channels: string[];
}

export interface Agent {
  id: string;
  name: string;
  config: AgentConfig;
  containerId?: string;
  status: "created" | "running" | "stopped" | "error";
  createdAt: Date;
}
