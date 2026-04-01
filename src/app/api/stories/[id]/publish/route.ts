import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// POST /api/stories/[id]/publish — publish a story
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getOrCreateDbUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story || story.authorId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json();

  const updated = await prisma.story.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      title: body.title || story.title,
      description: body.description || story.description,
      coverImageUrl: body.coverImageUrl !== undefined ? body.coverImageUrl : story.coverImageUrl,
      tags: body.tags || story.tags,
    },
  });

  return NextResponse.json({ success: true, id: updated.id });
}
