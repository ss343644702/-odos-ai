import { z } from 'zod';
import type { SkillDefinition } from '../types';
import { OUTLINE_SYSTEM_PROMPT, OUTLINE_USER_PROMPT } from '@/lib/agent/prompts/outline';

// ── Output Schema ──

const OutlineOutput = z.object({
  theme: z.string(),
  worldView: z.string(),
  tone: z.string(),
  depth: z.number(),
  playerObjective: z.object({
    primary: z.string(),
    hidden: z.string(),
    measurement: z.string(),
  }).optional(),
  characters: z.array(z.object({
    name: z.string(),
    role: z.string(),
    description: z.string(),
    gender: z.string(),
    secret: z.string().optional(),
  })),
  plotPoints: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    hook: z.string().optional(),
    conflict: z.string().optional(),
    suspense: z.string().optional(),
    isDecisionPoint: z.boolean().optional(),
    dilemma: z.string().optional(),
    strategyOptions: z.array(z.string()).optional(),
  })),
  endings: z.array(z.object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    description: z.string(),
    requirement: z.string().optional(),
  })),
});

// ── Input Type ──

type OutlineInput = {
  storyDescription: string;
  styleName: string;
  depth?: number;
};

// ── Skill Definition ──

export const outlineSkill: SkillDefinition<OutlineInput, z.infer<typeof OutlineOutput>> = {
  name: 'outlineGenerator',
  description: '生成剧本大纲（角色、情节脉络、结局方向、玩家目标）',

  systemPrompt: OUTLINE_SYSTEM_PROMPT,

  buildUserMessage: (input) => OUTLINE_USER_PROMPT(input.storyDescription, input.styleName, input.depth),

  outputSchema: OutlineOutput,

  outputExample: `{
  "theme": "故事主题",
  "worldView": "世界观(200字以内)",
  "tone": "基调",
  "depth": 9,
  "playerObjective": {"primary":"目标","hidden":"真相","measurement":"维度"},
  "characters": [{"name":"名","role":"player","description":"简介","gender":"male","secret":"秘密"}],
  "plotPoints": [{"id":"plot_1","title":"标题","description":"描述","hook":"钩子","conflict":"冲突","suspense":"悬念"}],
  "endings": [{"id":"ending_1","title":"结局名","type":"good","description":"描述","requirement":"条件"}]
}`,

  config: {
    temperature: 0.7,
    maxTokens: 16384,
    jsonMode: true,
  },
};
