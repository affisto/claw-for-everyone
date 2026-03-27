export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  config?: Record<string, { type: string; required?: boolean; description?: string }>;
}

export interface SkillContext {
  agentId: string;
  agentName: string;
  config: Record<string, string>;
  sendMessage: (channel: string, message: string) => Promise<void>;
  getResource: (key: string) => Promise<string | null>;
  setResource: (key: string, value: string) => Promise<void>;
  createPage: (slug: string, title: string, html: string) => Promise<void>;
}

export interface Skill {
  manifest: SkillManifest;
  activate(ctx: SkillContext): Promise<void>;
  deactivate?(): Promise<void>;
  handleMessage?(message: string, ctx: SkillContext): Promise<string | null>;
}
