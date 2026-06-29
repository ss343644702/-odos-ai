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

  // Auto-generate an incrementing "未命名项目(N)" when no explicit title is given
  // (treat the legacy placeholders as "no title" too).
  const PLACEHOLDERS = new Set(['', '新影游', '未命名影游', '未命名项目']);
  let title: string = (body.title || '').trim();
  if (PLACEHOLDERS.has(title)) {
    const existing = await prisma.story.findMany({
      where: { authorId: user.id, title: { startsWith: '未命名项目' } },
      select: { title: true },
    });
    let max = 0;
    for (const s of existing) {
      const m = s.title.match(/^未命名项目\((\d+)\)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    title = `未命名项目(${max + 1})`;
  }

  const story = await prisma.story.create({
    data: {
      authorId: user.id,
      title,
      description: body.description || '',
      data: body.data || { nodes: [], edges: [], settings: {}, style: {}, worldView: '' },
      entities: body.entities || null,
      tags: body.tags || [],
    },
  });

  return NextResponse.json({ id: story.id, title: story.title });
}
