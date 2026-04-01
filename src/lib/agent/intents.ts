import type { SkillName } from './types';

// ============================================================
// Intent Types
// ============================================================

export type IntentType =
  | 'continue_pipeline'
  | 'retry_current'
  | 'rerun_step'
  | 'edit_node'
  | 'general_chat'
  | 'create_story'
  | 'new_story';

export interface IntentResult {
  intent: IntentType;
  params: IntentParams;
}

export interface IntentParams {
  targetSkill?: SkillName;
  nodeIndex?: number;        // 1-based
  field?: string;            // narration | title | dialogue | character
  newValue?: string;
  question?: string;
  description?: string;      // create_story: extracted story description
  depth?: number;            // create_story: layer depth
  genre?: string;            // create_story: story genre
}

// ============================================================
// Skill pipeline order
// ============================================================

export const SKILL_PIPELINE: SkillName[] = [
  'styleConfirm',
  'outlineGenerator',
  'branchGenerator',
  'entityExtractor',
  'storyboardGenerator',
  'voiceGenerator',
];

// ============================================================
// Fast-path regex matching (no LLM call needed)
// ============================================================

const FAST_PATH_RULES: { pattern: RegExp; intent: IntentType }[] = [
  { pattern: /^(继续|确认|下一步|好的?|可以|没问题|ok)$/i, intent: 'continue_pipeline' },
  { pattern: /^(重试|重新生成)$/, intent: 'retry_current' },
  { pattern: /^(创建新故事|新故事|重新开始|重头开始|从头开始)$/, intent: 'new_story' },
];

// Skill name keyword mapping for rerun detection
const SKILL_KEYWORDS: { keywords: string[]; skill: SkillName }[] = [
  { keywords: ['大纲', '剧本'], skill: 'outlineGenerator' },
  { keywords: ['分支', '剧情树', '分支剧情'], skill: 'branchGenerator' },
  { keywords: ['主体', '角色', '实体', '人物'], skill: 'entityExtractor' },
  { keywords: ['分镜', '画面'], skill: 'storyboardGenerator' },
  { keywords: ['配音', '语音', 'TTS', 'tts', '声音'], skill: 'voiceGenerator' },
];

export function matchFastPath(text: string): IntentResult | null {
  const trimmed = text.trim();

  // 1. Exact matches
  for (const rule of FAST_PATH_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { intent: rule.intent, params: {} };
    }
  }

  // 2. "重新生成X" pattern → rerun_step
  const rerunMatch = trimmed.match(/^重新生成(.+)$/);
  if (rerunMatch) {
    const target = rerunMatch[1];
    for (const sk of SKILL_KEYWORDS) {
      if (sk.keywords.some((kw) => target.includes(kw))) {
        return { intent: 'rerun_step', params: { targetSkill: sk.skill } };
      }
    }
  }

  // 3. "重新X" pattern
  const rerunMatch2 = trimmed.match(/^重新(.+)$/);
  if (rerunMatch2) {
    const target = rerunMatch2[1];
    for (const sk of SKILL_KEYWORDS) {
      if (sk.keywords.some((kw) => target.includes(kw))) {
        return { intent: 'rerun_step', params: { targetSkill: sk.skill } };
      }
    }
  }

  return null;
}
