import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// POST /api/sessions — create a play session
export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await getOrCreateDbUser();

  const session = await prisma.playSession.create({
    data: {
      storyId: body.storyId,
      playerId: user?.id || null,
      currentNodeId: body.currentNodeId,
      history: body.history || [],
    },
  });

  return NextResponse.json({ id: session.id });
}
