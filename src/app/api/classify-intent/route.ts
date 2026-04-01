import { NextRequest, NextResponse } from 'next/server';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';
import { INTENT_SYSTEM_PROMPT, INTENT_USER_PROMPT } from '@/lib/agent/prompts/intent';

export async function POST(request: NextRequest) {
  try {
    const { userMessage, currentSkill, completedSkills, hasStory, nodeCount } =
      await request.json();

    const systemPrompt = INTENT_SYSTEM_PROMPT;
    const userPrompt = INTENT_USER_PROMPT(
      userMessage,
      currentSkill,
      completedSkills || [],
      hasStory || false,
      nodeCount || 0,
    );

    const response = await callLLM({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.1,
      maxTokens: 512,
    });

    const parsed = parseJsonFromResponse(response);
    return NextResponse.json(parsed);
  } catch (error: unknown) {
    console.error('Intent classification error:', error);
    // Fallback to general_chat on any error
    return NextResponse.json({
      intent: 'general_chat',
      params: {},
    });
  }
}
