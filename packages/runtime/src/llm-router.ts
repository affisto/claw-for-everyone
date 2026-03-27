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

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
  lmstudio: "openai/gpt-oss-20b",
};

function getDefaultModel(provider: LLMProvider): string {
  return provider.model || DEFAULT_MODELS[provider.type];
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("");
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
      case "lmstudio":
        return this.chatLmStudio(provider, messages);
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
        model: getDefaultModel(provider),
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: chatMessages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error: ${res.status} ${err}`);
    }

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
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    if (!provider.apiKey) throw new Error("OpenAI requires apiKey");
    return this.chatOpenAICompatible(provider, messages, "openai", true);
  }

  private async chatLmStudio(
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    return this.chatOpenAICompatible(
      {
        ...provider,
        baseUrl: provider.baseUrl || "http://host.docker.internal:1234",
      },
      messages,
      "lmstudio",
      false,
    );
  }

  private async chatOpenAICompatible(
    provider: LLMProvider,
    messages: LLMMessage[],
    providerName: "openai" | "lmstudio",
    requireApiKey: boolean,
  ): Promise<LLMResponse> {
    if (requireApiKey && !provider.apiKey) {
      throw new Error(`${providerName === "openai" ? "OpenAI" : "LM Studio"} requires apiKey`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    const res = await fetch(`${provider.baseUrl || "https://api.openai.com"}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: getDefaultModel(provider),
        max_tokens: 4096,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
      id: string;
      model: string;
      choices: { message: { content: unknown } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: extractTextContent(data.choices[0]?.message?.content),
      provider: providerName,
      model: data.model,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
    };
  }

  private async chatGemini(
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    if (!provider.apiKey) throw new Error("Gemini requires apiKey");

    const systemMessage = messages.find((m) => m.role === "system");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const model = getDefaultModel(provider);
    const res = await fetch(
      `${provider.baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent?key=${provider.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents,
          system_instruction: systemMessage
            ? { parts: [{ text: systemMessage.content }] }
            : undefined,
          generationConfig: {
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    return {
      content: data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "",
      provider: "gemini",
      model,
      usage: data.usageMetadata ? {
        inputTokens: data.usageMetadata.promptTokenCount || 0,
        outputTokens: data.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  private async chatOllama(
    provider: LLMProvider,
    messages: LLMMessage[],
  ): Promise<LLMResponse> {
    const res = await fetch(`${provider.baseUrl || "http://127.0.0.1:11434"}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getDefaultModel(provider),
        stream: false,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
      model: string;
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content || "",
      provider: "ollama",
      model: data.model,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
    };
  }
}
