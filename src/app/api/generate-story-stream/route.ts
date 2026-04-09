import { NextRequest } from 'next/server';
import { callLLMStream } from '@/lib/claude';
import { moderateContent, sanitizeOutput } from '@/lib/safety';
import { checkRateLimit, getRateLimitKey, GENERATE_LIMIT } from '@/lib/rate-limit';
import { OUTLINE_SYSTEM_PROMPT, OUTLINE_USER_PROMPT } from '@/lib/agent/prompts/outline';
import { BRANCH_SYSTEM_PROMPT, BRANCH_USER_PROMPT, BRANCH_COMPLETE_USER_PROMPT, BRANCH_MAINLINE_SYSTEM_PROMPT, BRANCH_MAINLINE_USER_PROMPT, BRANCH_SUBLINE_SYSTEM_PROMPT, BRANCH_SUBLINE_USER_PROMPT } from '@/lib/agent/prompts/branch';
import { ENTITY_SYSTEM_PROMPT, ENTITY_USER_PROMPT } from '@/lib/agent/prompts/entity';
import { STORYBOARD_SYSTEM_PROMPT, STORYBOARD_USER_PROMPT } from '@/lib/agent/prompts/storyboard';
import { VOICE_SYSTEM_PROMPT, VOICE_USER_PROMPT } from '@/lib/agent/prompts/voice';
import { CHAT_SYSTEM_PROMPT, CHAT_USER_PROMPT } from '@/lib/agent/prompts/chat';
import { EXPAND_SYSTEM_PROMPT, EXPAND_USER_PROMPT } from '@/lib/agent/prompts/expand';
import { parseJsonFromResponse } from '@/lib/claude';

/**
 * SSE streaming endpoint for story generation skills.
 *
 * Sends events:
 *   data: {"type":"chunk","text":"..."}\n\n       — partial LLM output
 *   data: {"type":"done","result":...}\n\n        — final parsed result
 *   data: {"type":"error","message":"..."}\n\n    — error
 */
export async function POST(request: NextRequest) {
  const { skill, input } = await request.json();

  // Rate limiting
  const rateLimitKey = getRateLimitKey(request);
  const rateResult = checkRateLimit(`generate:${rateLimitKey}`, GENERATE_LIMIT);
  if (!rateResult.allowed) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: '请求过于频繁，请稍后再试' })}\n\n`,
      { status: 429, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

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
    case 'branchComplete':
      systemPrompt = BRANCH_SYSTEM_PROMPT;
      userMessage = BRANCH_COMPLETE_USER_PROMPT(
        JSON.stringify(input.outline),
        JSON.stringify(input.existingNodes),
        JSON.stringify(input.existingEdges),
        JSON.stringify(input.pendingExpansions),
      );
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
    case 'branchMainline':
      systemPrompt = BRANCH_MAINLINE_SYSTEM_PROMPT;
      userMessage = BRANCH_MAINLINE_USER_PROMPT(JSON.stringify(input.outline));
      break;
    case 'branchSubline':
      systemPrompt = BRANCH_SUBLINE_SYSTEM_PROMPT;
      userMessage = BRANCH_SUBLINE_USER_PROMPT(
        JSON.stringify(input.outline),
        input.mainlineNodes,
        input.branchPointNode,
        input.branchIndex,
        input.endingHint,
      );
      break;
    case 'editOutline':
      systemPrompt = `你是一个故事大纲编辑助手。用户会给你一个现有大纲（JSON）和一条修改指令。
请根据指令修改大纲，返回完整的修改后 JSON。

规则：
- 只修改指令要求的部分，其余保持不变
- 保持 JSON 结构和字段名不变
- 角色的 gender 只能是 "male"、"female"、"other"
- 结局的 type 只能是 "good"、"bad"、"neutral"、"hidden"
- 直接返回 JSON，不要包含其他文字`;
      userMessage = `现有大纲：
${JSON.stringify(input.existingOutline, null, 2)}

修改指令：${input.instruction}

请返回修改后的完整大纲 JSON：`;
      break;
    default:
      return new Response(
        `data: ${JSON.stringify({ type: 'error', message: `Unknown skill: ${skill}` })}\n\n`,
        { status: 400, headers: { 'Content-Type': 'text/event-stream' } },
      );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = '';

      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await callLLMStream({
          systemPrompt,
          userMessage,
          temperature: (skill === 'branchGenerator' || skill === 'branchComplete' || skill === 'expandNode' || skill === 'branchMainline' || skill === 'branchSubline') ? 0.7 : (skill === 'outlineGenerator' ? 0.6 : 0.7),
          maxTokens: (skill === 'branchGenerator' || skill === 'branchComplete' || skill === 'outlineGenerator' || skill === 'editOutline' || skill === 'branchMainline' || skill === 'branchSubline') ? 16384 : (skill === 'chat' ? 2048 : 4096),
          jsonMode: skill !== 'chat',
          onChunk(text) {
            fullText += text;
            sendEvent({ type: 'chunk', text });
          },
          onDone() {
            try {
              if (skill === 'chat') {
                const modResult = moderateContent(fullText);
                const reply = modResult.safe ? fullText : sanitizeOutput(fullText);
                sendEvent({ type: 'done', result: { reply } });
              } else {
                const parsed = parseJsonFromResponse(fullText);
                // Moderate narration in nodes
                if (parsed.nodes && Array.isArray(parsed.nodes)) {
                  for (const node of parsed.nodes) {
                    if (node.data?.narration) {
                      const mod = moderateContent(node.data.narration);
                      if (!mod.safe) node.data.narration = sanitizeOutput(node.data.narration);
                    }
                  }
                }
                sendEvent({ type: 'done', result: parsed });
              }
            } catch (parseError: any) {
              console.error(`[stream] ${skill} parse failed. Raw output (first 800 chars):\n${fullText.slice(0, 800)}`);
              sendEvent({ type: 'error', message: parseError.message || 'Failed to parse response' });
            }
            controller.close();
          },
        });
      } catch (error: any) {
        sendEvent({ type: 'error', message: error.message || 'Stream failed' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
