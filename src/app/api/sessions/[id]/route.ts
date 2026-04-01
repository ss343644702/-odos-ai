import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PUT /api/sessions/[id] — update session (choice made, node changed)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const session = await prisma.playSession.update({
    where: { id },
    data: {
      currentNodeId: body.currentNodeId,
      history: body.history,
    },
  });

  return NextResponse.json({ success: true, updatedAt: session.updatedAt });
}
