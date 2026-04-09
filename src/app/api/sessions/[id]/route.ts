import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PUT /api/sessions/[id] — update session (choice made, node changed)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const data: Record<string, any> = {};
    if (body.currentNodeId !== undefined) data.currentNodeId = body.currentNodeId;
    if (body.history !== undefined) data.history = body.history;
    if (body.achievements !== undefined) data.achievements = body.achievements;
    if (body.dynamicNodes !== undefined) data.dynamicNodes = body.dynamicNodes;
    if (body.dynamicEdges !== undefined) data.dynamicEdges = body.dynamicEdges;

    const session = await prisma.playSession.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true, updatedAt: session.updatedAt });
  } catch (err: any) {
    // If achievements field doesn't exist in DB yet, retry without it
    if (err.message?.includes('achievements') || err.message?.includes('Unknown argument')) {
      const data: Record<string, any> = {};
      if (body.currentNodeId !== undefined) data.currentNodeId = body.currentNodeId;
      if (body.history !== undefined) data.history = body.history;
      const session = await prisma.playSession.update({ where: { id }, data });
      return NextResponse.json({ success: true, updatedAt: session.updatedAt });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
