import type { BranchGeneratorInput, BranchGeneratorOutput } from '../types';
import { createSampleStory } from '@/lib/mock/mockStories';

export async function runBranchGenerator(input: BranchGeneratorInput): Promise<BranchGeneratorOutput> {
  // In production: call Claude API with BRANCH_SYSTEM_PROMPT
  // Mock: return the sample story data
  const sampleStory = createSampleStory();

  return {
    nodes: sampleStory.nodes,
    edges: sampleStory.edges,
    selfReview: {
      rating: 8,
      strengths: [
        '每个选项都具有迷惑性，让用户陷入两难',
        '部分节点隐藏了正确方向，需要自由输入',
        '所有分支最终收束到3个结局',
      ],
      issues: [],
      fixes: [],
    },
  };
}
