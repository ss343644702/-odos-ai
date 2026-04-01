import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateDbUser } from '@/lib/auth';

// GET /api/stories — list published stories (public)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get('tag');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const where: any = { status: 'PUBLISHED' };
  if (tag && tag !== '全部') {
    where.tags = { has: tag };
  }

  const [stories, total] = await Promise.all([
    prisma.story.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        title: true,
        description: true,
        coverImageUrl: true,
        tags: true,
        playCount: true,
        likeCount: true,
        publishedAt: true,
        author: { select: { nickname: true, avatarUrl: true } },
      },
    }),
    prisma.story.count({ where }),
  ]);

  return NextResponse.json({ stories, total, page, limit });
}

// POST /api/stories — create new draft (requires auth)
export async function POST(request: NextRequest) {
  const user = await getOrCreateDbUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const story = await prisma.story.create({
    data: {
      authorId: user.id,
      title: body.title || '未命名影游',
      description: body.description || '',
      data: body.data || { nodes: [], edges: [], settings: {}, style: {}, worldView: '' },
      entities: body.entities || null,
      tags: body.tags || [],
    },
  });

  return NextResponse.json({ id: story.id });
}
