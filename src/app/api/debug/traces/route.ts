import { NextResponse } from 'next/server';
import {
  getRecentTraces,
  getTraceStats,
  getRecentPipelineTraces,
  getPipelineStageStats,
} from '@/lib/trace';

export async function GET() {
  return NextResponse.json({
    stats: getTraceStats(),
    traces: getRecentTraces(50),
    // 自由输入分阶段耗时（decision / storyboard+voice / tts / image）
    pipelineStats: getPipelineStageStats(),
    pipelineTraces: getRecentPipelineTraces(30),
  });
}
