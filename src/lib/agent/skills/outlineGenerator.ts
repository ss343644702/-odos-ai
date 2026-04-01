import type { OutlineGeneratorInput, OutlineGeneratorOutput } from '../types';
import type { StoryOutline } from '@/types/story';

export async function runOutlineGenerator(input: OutlineGeneratorInput): Promise<OutlineGeneratorOutput> {
  // In production: call Claude API with OUTLINE_SYSTEM_PROMPT
  // Mock implementation
  const outline: StoryOutline = {
    theme: input.storyDescription,
    worldView: '一个充满未知与选择的世界',
    tone: '悬疑紧张，带有温情',
    depth: 4,
    characters: [
      { name: '主角', role: '主角', description: '故事的主人公', gender: 'male' },
      { name: '导师', role: '配角', description: '给予主角指引的人', gender: 'female' },
      { name: '对手', role: '反派', description: '阻碍主角前进的人', gender: 'male' },
    ],
    mainPlotPoints: [
      { id: 'plot_1', title: '开场', description: '主角面临新的挑战', hook: '意外的相遇', conflict: '内心的矛盾', suspense: '隐藏的秘密' },
      { id: 'plot_2', title: '发展', description: '线索逐渐浮出水面', hook: '新的发现', conflict: '信任的考验', suspense: '真相的一角' },
      { id: 'plot_3', title: '高潮', description: '面对最终的选择', hook: '意想不到的转折', conflict: '终极对决', suspense: '最后的谜底' },
    ],
    endings: [
      { id: 'ending_best', title: '完美结局', type: 'best', description: '所有谜团解开，主角实现目标' },
      { id: 'ending_good', title: '不完美的胜利', type: 'good', description: '付出代价但获得成长' },
      { id: 'ending_bad', title: '失败结局', type: 'bad', description: '选择失误导致遗憾' },
    ],
  };

  return { outline };
}
