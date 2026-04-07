import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { callLLM } from '@/lib/claude';

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

  if (branches.length === 0) {
    return NextResponse.json({ branch: null });
  }

  // Step 1: Quick exact match (free, instant)
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const inputNorm = normalize(input);
  for (const branch of branches) {
    if (normalize(branch.playerInput) === inputNorm) {
      await prisma.generatedBranch.update({
        where: { id: branch.id },
        data: { usageCount: { increment: 1 } },
      });
      return NextResponse.json({ branch });
    }
  }

  // Step 2: LLM semantic matching
  try {
    const candidateList = branches.map((b, i) => `${i + 1}. "${b.playerInput}"`).join('\n');
    const llmResponse = await callLLM({
      systemPrompt: `你是一个语义匹配引擎。判断用户输入和候选列表中哪一项语义最接近。
规则：
- 只有语义真正相近才匹配（表达的是同一个意图/动作）
- "打电话给老婆"和"打电话给律师"不算匹配（对象不同）
- "打电话给老婆"和"给老婆打个电话"算匹配（同一个意图）
- 如果没有任何候选匹配，返回 0
输出格式：只输出一个数字（匹配的候选编号，或 0 表示无匹配）`,
      userMessage: `用户输入："${input}"\n\n候选列表：\n${candidateList}`,
      temperature: 0,
      maxTokens: 16,
    });

    const matchIdx = parseInt(llmResponse.trim(), 10);
    if (matchIdx > 0 && matchIdx <= branches.length) {
      const matched = branches[matchIdx - 1];
      await prisma.generatedBranch.update({
        where: { id: matched.id },
        data: { usageCount: { increment: 1 } },
      });
      return NextResponse.json({ branch: matched });
    }
  } catch {
    // LLM failure — no match, proceed to pipeline
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
