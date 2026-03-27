import type { LLMProvider, LLMProviderType } from "./types.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  provider: LLMProviderType;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export class LLMRouter {
  async chat(
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    switch (provider.type) {
      case "claude":
        return this.chatClaude(provider, messages);
      case "openai":
        return this.chatOpenAI(provider, messages);
      case "gemini":
        return this.chatGemini(provider, messages);
      case "ollama":
        return this.chatOllama(provider, messages);
      default:
        throw new Error(`Unsupported provider: ${provider.type}`);
    }
  }

  private async chatClaude(
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    const apiKey = provider.apiKey || provider.oauthToken;
    if (!apiKey) throw new Error("Claude requires apiKey or oauthToken");

    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: chatMessages,
      }),
    });

    const data = (await res.json()) as {
      content: { text: string }[];
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      content: data.content[0].text,
      provider: "claude",
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  private async chatOpenAI(
    _provider: LLMProvider,
    _messages: LLMMessage[],
  ): Promise<LLMResponse> {
    // TODO: Implement OpenAI integration
    throw new Error("OpenAI provider not yet implemented");
  }

  private async chatGemini(
    _provider: LLMProvider,
    _messages: LLMMessage[],
  ): Promise<LLMResponse> {
    // TODO: Implement Gemini integration
    throw new Error("Gemini provider not yet implemented");
  }

  private async chatOllama(
    _provider: LLMProvider,
    _messages: LLMMessage[],
  ): Promise<LLMResponse> {
    // TODO: Implement Ollama integration
    throw new Error("Ollama provider not yet implemented");
  }
}
