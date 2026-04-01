import { v4 as uuid } from 'uuid';
import type { StoryboardGeneratorInput, StoryboardGeneratorOutput } from '../types';

export async function runStoryboardGenerator(input: StoryboardGeneratorInput): Promise<StoryboardGeneratorOutput> {
  const node = input.node;
  const character = node.data.character
    ? input.entities.characters.find((c) => c.name === node.data.character)
    : null;

  const sceneEntity = input.entities.scenes[0];
  const stylePrefix = input.style.stylePromptPrefix;

  // Split narration into 2-3 visual moments
  const narration = node.data.narration;
  const sentences = narration.match(/[^。！？.!?]+[。！？.!?]?/g) || [narration];

  // Group sentences into 2-3 frames
  const frameCount = Math.min(3, Math.max(2, Math.ceil(sentences.length / 2)));
  const perFrame = Math.ceil(sentences.length / frameCount);

  const frames: { narrationSegment: string; imagePrompt: string; entityRefs: string[]; duration: number }[] = [];

  for (let i = 0; i < frameCount; i++) {
    const segment = sentences.slice(i * perFrame, (i + 1) * perFrame).join('');
    if (!segment.trim()) continue;

    const entityRefs: string[] = [];
    const promptParts = [stylePrefix];

    if (sceneEntity) {
      promptParts.push(sceneEntity.imagePrompt);
      entityRefs.push(sceneEntity.id);
    }
    if (character) {
      promptParts.push(character.imagePrompt);
      entityRefs.push(character.id);
    }

    // Add frame-specific context from narration
    promptParts.push(segment.slice(0, 80));

    // Vary camera angles per frame
    const angles = ['medium shot, eye level', 'close-up, dramatic angle', 'wide shot, establishing'];
    promptParts.push(angles[i % angles.length]);

    frames.push({
      narrationSegment: segment,
      imagePrompt: promptParts.filter(Boolean).join(', '),
      entityRefs,
      duration: Math.max(3, Math.ceil(segment.length / 15)),
    });
  }

  return {
    storyboard: {
      nodeId: node.id,
      narration: node.data.narration,
      dialogue: node.data.dialogue,
      character: node.data.character,
      scene: sceneEntity?.name || '未知场景',
      imagePrompt: frames[0]?.imagePrompt || '',
      cameraAngle: 'medium shot, eye level',
      mood: sceneEntity?.mood || 'neutral',
      frames,
    },
  };
}
