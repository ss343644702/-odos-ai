import type { EntityExtractorInput, EntityExtractorOutput } from '../types';

export async function runEntityExtractor(input: EntityExtractorInput): Promise<EntityExtractorOutput> {
  // In production: call Claude API with ENTITY_SYSTEM_PROMPT
  // Mock implementation based on outline characters
  const characters = input.outline.characters.map((c, i) => ({
    id: `char_${i}`,
    name: c.name,
    description: c.description,
    appearance: `${c.gender === 'male' ? '男性' : '女性'}，${c.role === '主角' ? '年轻干练' : c.role === '反派' ? '面带笑容但眼神锐利' : '温和知性'}`,
    personality: c.description,
    gender: c.gender as 'male' | 'female' | 'other',
    ageRange: c.role === '主角' ? '25-30' : '35-45',
    voiceType: c.gender === 'female' ? 'mature_female' as const : 'mature_male' as const,
    imagePrompt: `portrait of ${c.gender} character, ${c.description}, ${input.style.stylePromptPrefix}`,
    imageUrl: null,
  }));

  return {
    entities: {
      characters,
      scenes: [
        { id: 'scene_1', name: '办公室', description: '现代办公环境', mood: 'professional', lighting: 'fluorescent', imagePrompt: `modern office interior, ${input.style.stylePromptPrefix}`, imageUrl: null },
        { id: 'scene_2', name: '会议室', description: '玻璃隔间会议室', mood: 'tense', lighting: 'bright', imagePrompt: `glass meeting room, ${input.style.stylePromptPrefix}`, imageUrl: null },
      ],
      props: [
        { id: 'prop_1', name: '文件', description: '关键文件', significance: '推动剧情的重要道具', imagePrompt: `important document on desk, ${input.style.stylePromptPrefix}`, imageUrl: null },
      ],
    },
  };
}
