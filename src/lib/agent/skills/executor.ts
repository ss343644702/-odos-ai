import { getSkill } from './registry';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';

/**
 * Execute a registered skill: build prompt → call LLM → parse → validate → retry if needed
 */
export async function executeSkill<TOutput = any>(
  skillName: string,
  input: any,
): Promise<TOutput> {
  const skill = getSkill(skillName);
  if (!skill) throw new Error(`Skill "${skillName}" not found in registry`);

  const systemPrompt = skill.systemPrompt;
  const userMessage = skill.buildUserMessage(input);

  // 1. First attempt
  const raw = await callLLM({
    systemPrompt,
    userMessage,
    temperature: skill.config.temperature,
    maxTokens: skill.config.maxTokens,
    skill: skillName,
    responseFormat: skill.config.jsonMode ? { type: 'json_object' as const } : undefined,
  });

  // 2. Free-text skill — return raw
  if (skill.config.freeText) return raw as TOutput;

  // 3. Parse JSON
  let parsed: any;
  try {
    parsed = parseJsonFromResponse(raw);
  } catch (parseErr: any) {
    console.log(`[Skill ${skillName}] JSON parse failed, retrying with schema hint`);
    return retryWithHint<TOutput>(skill, systemPrompt, userMessage);
  }

  // 4. Zod validate
  const result = skill.outputSchema.safeParse(parsed);
  if (result.success) return result.data;

  // 5. Validation failed — retry with hint
  console.log(`[Skill ${skillName}] Zod validation failed: ${JSON.stringify((result as any).error?.issues?.slice(0, 3))}`);
  return retryWithHint<TOutput>(skill, systemPrompt, userMessage, parsed);
}

/**
 * Retry LLM call with output schema hint injected into the prompt
 */
async function retryWithHint<TOutput>(
  skill: ReturnType<typeof getSkill> & {},
  systemPrompt: string,
  originalUserMessage: string,
  previousParsed?: any,
): Promise<TOutput> {
  const retryMessage = originalUserMessage +
    `\n\n[重要] 请严格按照以下 JSON 结构输出，不要使用 markdown 代码块包裹：\n${skill.outputExample}`;

  const retryRaw = await callLLM({
    systemPrompt,
    userMessage: retryMessage,
    temperature: skill.config.temperature,
    maxTokens: skill.config.maxTokens,
    skill: `${skill.name}_retry`,
    responseFormat: { type: 'json_object' as const },
  });

  try {
    const retryParsed = parseJsonFromResponse(retryRaw);
    const retryResult = skill.outputSchema.safeParse(retryParsed);
    if (retryResult.success) return retryResult.data;
    // Retry parsed but validation failed — return it anyway (best effort)
    console.error(`[Skill ${skill.name}] Retry validation also failed, returning best-effort parse`);
    return retryParsed;
  } catch {
    // Even retry parse failed — return previous parsed if available
    if (previousParsed) return previousParsed;
    throw new Error(`Skill "${skill.name}" failed after retry`);
  }
}
