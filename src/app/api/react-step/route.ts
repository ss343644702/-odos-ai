import { NextRequest, NextResponse } from 'next/server';
import { callDeepSeek } from '@/lib/claude';

export async function POST(request: NextRequest) {
  try {
    const { messages, modelConfig } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages array is required' },
        { status: 400 },
      );
    }

    const content = await callDeepSeek({
      messages,
      temperature: modelConfig?.temperature ?? 0.3,
      maxTokens: modelConfig?.maxTokens ?? 2048,
      model: modelConfig?.model,
    });

    return NextResponse.json({ content });
  } catch (error: any) {
    console.error('[react-step] error:', error);
    return NextResponse.json(
      { error: error.message || 'ReAct step failed' },
      { status: 500 },
    );
  }
}
