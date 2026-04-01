import { NextRequest, NextResponse } from 'next/server';
import { submitImageGeneration, queryImageResult } from '@/lib/keling';

export async function POST(request: NextRequest) {
  const { prompt, aspectRatio, nodeId, image_list } = await request.json();

  if (!prompt) {
    return NextResponse.json({ success: false, error: 'prompt is required' }, { status: 400 });
  }

  try {
    const taskId = await submitImageGeneration({
      prompt,
      aspect_ratio: aspectRatio || '16:9',
      image_list: image_list || undefined,
    });

    return NextResponse.json({
      success: true,
      taskId,
      nodeId,
      status: 'submitted',
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Image generation failed',
    }, { status: 500 });
  }
}

// Poll for image result
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
  }

  try {
    const result = await queryImageResult(taskId);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
