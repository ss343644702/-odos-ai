import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/branches?storyId=&parentNodeId=&input= — find reusable branch
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const storyId = searchParams.get('storyId');
  const parentNodeId = searchParams.get('parentNodeId');
  const input = searchParams.get('input') || '';

  if (!storyId || !parentNodeId) {
    return NextResponse.json({ branch: null });
  }

  // Find branches for this story+node
  const branches = await prisma.generatedBranch.findMany({
    where: { storyId, parentNodeId },
    orderBy: { usageCount: 'desc' },
    take: 10,
  });

  // Character overlap matching (>70%)
  const inputLower = input.toLowerCase().trim();
  const inputChars = [...inputLower];

  for (const branch of branches) {
    const cached = branch.playerInput.toLowerCase().trim();
    const matchCount = inputChars.filter((ch) => cached.includes(ch)).length;
    if (matchCount / Math.max(inputChars.length, 1) > 0.7) {
      // Increment usage count
      await prisma.generatedBranch.update({
        where: { id: branch.id },
        data: { usageCount: { increment: 1 } },
      });
      return NextResponse.json({ branch });
    }
  }

  return NextResponse.json({ branch: null });
}

// POST /api/branches — save a generated branch
export async function POST(request: NextRequest) {
  const body = await request.json();

  const branch = await prisma.generatedBranch.create({
    data: {
      storyId: body.storyId,
      parentNodeId: body.parentNodeId,
      playerInput: body.playerInput,
      generatedNodes: body.generatedNodes || [],
      generatedEdges: body.generatedEdges || [],
    },
  });

  return NextResponse.json({ id: branch.id });
}
