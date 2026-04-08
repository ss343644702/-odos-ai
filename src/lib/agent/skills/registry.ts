import type { SkillDefinition } from './types';

// Import skill definitions
import { outlineSkill } from './definitions/outline.skill';

const registry = new Map<string, SkillDefinition>();

// Register all skills
[outlineSkill].forEach(skill => registry.set(skill.name, skill));

export function registerSkill(skill: SkillDefinition): void {
  registry.set(skill.name, skill);
}

export function getSkill(name: string): SkillDefinition | undefined {
  return registry.get(name);
}

export function getAllSkills(): SkillDefinition[] {
  return Array.from(registry.values());
}

export { registry };
