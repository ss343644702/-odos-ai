import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// GET /api/stories/[id] — get story detail (public for published, owner for draft)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Draft stories require owner
  if (story.status === 'DRAFT') {
    const user = await getOrCreateDbUser();
    if (!user || user.id !== story.authorId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Increment play count for published stories
  if (story.status === 'PUBLISHED') {
    await prisma.story.update({
      where: { id },
      data: { playCount: { increment: 1 } },
    });
  }

  return NextResponse.json(story);
}

// PUT /api/stories/[id] — update draft (owner only, for auto-save)
export async function PUT(
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
      title: body.title ?? story.title,
      description: body.description ?? story.description,
      data: body.data ?? story.data,
      entities: body.entities !== undefined ? body.entities : story.entities,
      tags: body.tags ?? story.tags,
      coverImageUrl: body.coverImageUrl !== undefined ? body.coverImageUrl : story.coverImageUrl,
    },
  });

  return NextResponse.json({ success: true, updatedAt: updated.updatedAt });
}

// DELETE /api/stories/[id] — archive story (owner only)
export async function DELETE(
  _request: NextRequest,
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

  await prisma.story.update({
    where: { id },
    data: { status: 'ARCHIVED' },
  });

  return NextResponse.json({ success: true });
}
