import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// GET /api/sessions?storyId=xxx — get latest session for current user + story
export async function GET(request: NextRequest) {
  const storyId = request.nextUrl.searchParams.get('storyId');
  if (!storyId) return NextResponse.json({ session: null });

  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ session: null });

  const session = await prisma.playSession.findFirst({
    where: { storyId, playerId: user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ session });
}

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
