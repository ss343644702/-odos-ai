import type { VoiceSegment, VoiceType } from '@/types/story';

// Voice configuration for Web Speech API
const voiceConfig: Record<VoiceType, { pitch: number; rate: number }> = {
  narrator: { pitch: 1.0, rate: 0.9 },
  young_male: { pitch: 1.1, rate: 1.0 },
  mature_male: { pitch: 0.8, rate: 0.9 },
  young_female: { pitch: 1.3, rate: 1.0 },
  mature_female: { pitch: 1.1, rate: 0.9 },
  elder: { pitch: 0.7, rate: 0.8 },
  child: { pitch: 1.5, rate: 1.1 },
};

export function speakText(
  text: string,
  voiceType: VoiceType = 'narrator',
  options?: { onStart?: () => void; onEnd?: () => void; lang?: string },
): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;

  const config = voiceConfig[voiceType];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options?.lang || 'zh-CN';
  utterance.pitch = config.pitch;
  utterance.rate = config.rate;

  if (options?.onStart) utterance.onstart = options.onStart;
  if (options?.onEnd) utterance.onend = options.onEnd;

  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function speakSegments(
  segments: VoiceSegment[],
  onSegmentStart?: (segment: VoiceSegment) => void,
  onAllDone?: () => void,
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  let idx = 0;

  const speakNext = () => {
    if (idx >= segments.length) {
      onAllDone?.();
      return;
    }

    const seg = segments[idx];
    onSegmentStart?.(seg);

    speakText(seg.text, seg.voiceType, {
      onEnd: () => {
        idx++;
        speakNext();
      },
    });
  };

  speakNext();
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
