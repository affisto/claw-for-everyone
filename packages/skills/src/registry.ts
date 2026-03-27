import type { Skill } from "./types.js";

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill) {
    this.skills.set(skill.manifest.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  unregister(name: string): boolean {
    return this.skills.delete(name);
  }
}
