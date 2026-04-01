import { NextResponse } from 'next/server';
import { getRecentTraces, getTraceStats } from '@/lib/trace';

export async function GET() {
  return NextResponse.json({
    stats: getTraceStats(),
    traces: getRecentTraces(50),
  });
}
