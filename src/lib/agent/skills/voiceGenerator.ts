import type { VoiceGeneratorInput, VoiceGeneratorOutput } from '../types';
import type { VoiceSegment } from '@/types/story';
import { v4 as uuid } from 'uuid';

export async function runVoiceGenerator(input: VoiceGeneratorInput): Promise<VoiceGeneratorOutput> {
  // In production: call Claude API with VOICE_SYSTEM_PROMPT
  const segments: VoiceSegment[] = [];

  // Narration segment
  if (input.storyboard.narration) {
    segments.push({
      id: uuid(),
      text: input.storyboard.narration,
      speaker: 'narrator',
      voiceType: 'narrator',
      emotion: 'neutral',
      speed: 0.9,
    });
  }

  // Dialogue segment
  if (input.storyboard.dialogue && input.storyboard.character) {
    const character = input.entities.characters.find(
      (c) => c.name === input.storyboard.character
    );
    segments.push({
      id: uuid(),
      text: input.storyboard.dialogue,
      speaker: input.storyboard.character,
      voiceType: character?.voiceType || 'narrator',
      emotion: 'conversational',
      speed: 1.0,
    });
  }

  const voiceScript = segments
    .map((s) => `【${s.speaker}】(${s.emotion}) ${s.text}`)
    .join('\n\n');

  return { voiceSegments: segments, voiceScript };
}
