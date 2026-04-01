import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// GET /api/me/stories — list current user's stories
export async function GET() {
  const user = await getOrCreateDbUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stories = await prisma.story.findMany({
    where: {
      authorId: user.id,
      status: { not: 'ARCHIVED' },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      coverImageUrl: true,
      status: true,
      tags: true,
      playCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ stories });
}
