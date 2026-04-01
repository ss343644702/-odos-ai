import type {
  SkillName,
  StyleConfirmInput,
  StyleConfirmOutput,
  OutlineGeneratorInput,
  OutlineGeneratorOutput,
  BranchGeneratorInput,
  BranchGeneratorOutput,
  EntityExtractorInput,
  EntityExtractorOutput,
  StoryboardGeneratorInput,
  StoryboardGeneratorOutput,
  VoiceGeneratorInput,
  VoiceGeneratorOutput,
} from './types';

type SkillInput =
  | StyleConfirmInput
  | OutlineGeneratorInput
  | BranchGeneratorInput
  | EntityExtractorInput
  | StoryboardGeneratorInput
  | VoiceGeneratorInput;

type SkillOutput =
  | StyleConfirmOutput
  | OutlineGeneratorOutput
  | BranchGeneratorOutput
  | EntityExtractorOutput
  | StoryboardGeneratorOutput
  | VoiceGeneratorOutput;

// Skill pipeline order
export const SKILL_PIPELINE: SkillName[] = [
  'styleConfirm',
  'outlineGenerator',
  'branchGenerator',
  'entityExtractor',
  'storyboardGenerator',
  'voiceGenerator',
];

export function getNextSkill(current: SkillName): SkillName | null {
  const idx = SKILL_PIPELINE.indexOf(current);
  if (idx === -1 || idx >= SKILL_PIPELINE.length - 1) return null;
  return SKILL_PIPELINE[idx + 1];
}

export function getPreviousSkill(current: SkillName): SkillName | null {
  const idx = SKILL_PIPELINE.indexOf(current);
  if (idx <= 0) return null;
  return SKILL_PIPELINE[idx - 1];
}

// Execute a skill (non-streaming, backward compatible)
export async function executeSkill(
  skillName: SkillName,
  input: SkillInput,
): Promise<SkillOutput> {
  const response = await fetch('/api/generate-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: skillName, input }),
  });

  if (!response.ok) {
    throw new Error(`Skill ${skillName} failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Execute a skill with SSE streaming.
 * Provides real-time progress via onChunk callback, and returns the final result.
 */
export async function executeSkillStream(
  skillName: SkillName,
  input: SkillInput,
  onChunk?: (text: string) => void,
): Promise<SkillOutput> {
  const response = await fetch('/api/generate-story-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: skillName, input }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Skill ${skillName} stream failed: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: SkillOutput | null = null;
  let error: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;

      try {
        const event = JSON.parse(dataStr);
        if (event.type === 'chunk' && onChunk) {
          onChunk(event.text);
        } else if (event.type === 'done') {
          result = event.result;
        } else if (event.type === 'error') {
          error = event.message;
        }
      } catch {
        // skip malformed events
      }
    }
  }

  if (error) throw new Error(error);
  if (!result) throw new Error(`Skill ${skillName}: no result received from stream`);

  return result;
}
