import { NextRequest, NextResponse } from 'next/server';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';
import { moderateContent, sanitizeOutput } from '@/lib/safety';
import { checkRateLimit, getRateLimitKey, GENERATE_LIMIT, CHAT_LIMIT } from '@/lib/rate-limit';
import { OUTLINE_SYSTEM_PROMPT, OUTLINE_USER_PROMPT } from '@/lib/agent/prompts/outline';
import { BRANCH_SYSTEM_PROMPT, BRANCH_USER_PROMPT } from '@/lib/agent/prompts/branch';
import { ENTITY_SYSTEM_PROMPT, ENTITY_USER_PROMPT } from '@/lib/agent/prompts/entity';
import { STORYBOARD_SYSTEM_PROMPT, STORYBOARD_USER_PROMPT } from '@/lib/agent/prompts/storyboard';
import { VOICE_SYSTEM_PROMPT, VOICE_USER_PROMPT } from '@/lib/agent/prompts/voice';
import { CHAT_SYSTEM_PROMPT, CHAT_USER_PROMPT } from '@/lib/agent/prompts/chat';
import { EXPAND_SYSTEM_PROMPT, EXPAND_USER_PROMPT } from '@/lib/agent/prompts/expand';

export async function POST(request: NextRequest) {
  const { skill, input } = await request.json();

  // Rate limiting
  const limitConfig = skill === 'chat' ? CHAT_LIMIT : GENERATE_LIMIT;
  const rateLimitKey = getRateLimitKey(request);
  const rateResult = checkRateLimit(`generate:${rateLimitKey}`, limitConfig);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试', retryAfterMs: rateResult.resetMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rateResult.resetMs / 1000)) } },
    );
  }

  try {
    let systemPrompt = '';
    let userMessage = '';

    switch (skill) {
      case 'outlineGenerator':
        systemPrompt = OUTLINE_SYSTEM_PROMPT;
        userMessage = OUTLINE_USER_PROMPT(input.storyDescription, input.style?.styleName || '', input.depth);
        break;
      case 'branchGenerator':
        systemPrompt = BRANCH_SYSTEM_PROMPT;
        userMessage = BRANCH_USER_PROMPT(JSON.stringify(input.outline));
        break;
      case 'entityExtractor':
        systemPrompt = ENTITY_SYSTEM_PROMPT;
        userMessage = ENTITY_USER_PROMPT(JSON.stringify(input.nodes), input.style?.styleName || '');
        break;
      case 'storyboardGenerator':
        systemPrompt = STORYBOARD_SYSTEM_PROMPT;
        userMessage = STORYBOARD_USER_PROMPT(
          JSON.stringify(input.node),
          JSON.stringify(input.entities),
          input.style?.stylePromptPrefix || '',
        );
        break;
      case 'voiceGenerator':
        systemPrompt = VOICE_SYSTEM_PROMPT;
        userMessage = VOICE_USER_PROMPT(
          JSON.stringify(input.storyboard),
          JSON.stringify(input.entities),
        );
        break;
      case 'chat':
        systemPrompt = CHAT_SYSTEM_PROMPT;
        userMessage = CHAT_USER_PROMPT(input.question || '', input.storyContext || '');
        break;
      case 'expandNode':
        systemPrompt = EXPAND_SYSTEM_PROMPT;
        userMessage = EXPAND_USER_PROMPT(input as any);
        break;
      default:
        return NextResponse.json({ error: `Unknown skill: ${skill}` }, { status: 400 });
    }

    const response = await callLLM({
      systemPrompt,
      userMessage,
      temperature: (skill === 'branchGenerator' || skill === 'expandNode') ? 0.85 : (skill === 'chat' ? 0.7 : 0.7),
      maxTokens: (skill === 'branchGenerator' || skill === 'outlineGenerator') ? 8192 : (skill === 'chat' ? 2048 : 4096),
      skill,
    });

    // Chat skill returns free text, not JSON
    if (skill === 'chat') {
      const modResult = moderateContent(response);
      return NextResponse.json({ reply: modResult.safe ? response : sanitizeOutput(response) });
    }

    const parsed = parseJsonFromResponse(response);

    // Moderate narration text in generated story nodes
    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      for (const node of parsed.nodes) {
        if (node.data?.narration) {
          const modResult = moderateContent(node.data.narration);
          if (!modResult.safe) {
            node.data.narration = sanitizeOutput(node.data.narration);
          }
        }
      }
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error(`Skill ${skill} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Generation failed' },
      { status: 500 },
    );
  }
}
