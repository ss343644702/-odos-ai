import { NextRequest } from 'next/server';
import { callLLMStream } from '@/lib/claude';
import { moderateContent, sanitizeOutput } from '@/lib/safety';
import { checkRateLimit, getRateLimitKey, GENERATE_LIMIT } from '@/lib/rate-limit';
import { OUTLINE_SYSTEM_PROMPT, OUTLINE_USER_PROMPT } from '@/lib/agent/prompts/outline';
import { BRANCH_SYSTEM_PROMPT, BRANCH_USER_PROMPT } from '@/lib/agent/prompts/branch';
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
          temperature: (skill === 'branchGenerator' || skill === 'expandNode') ? 0.85 : 0.7,
          maxTokens: (skill === 'branchGenerator' || skill === 'outlineGenerator') ? 8192 : (skill === 'chat' ? 2048 : 4096),
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
