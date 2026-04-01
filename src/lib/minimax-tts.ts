import type { VoiceType } from '@/types/story';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';

const VOICE_MAP: Record<VoiceType, string> = {
  narrator: 'hunyin_6',
  young_male: 'Chinese (Mandarin)_Gentle_Youth',
  mature_male: 'Chinese (Mandarin)_Reliable_Executive',
  young_female: 'Chinese (Mandarin)_Warm_Girl',
  mature_female: 'Chinese (Mandarin)_Mature_Woman',
  elder: 'Chinese (Mandarin)_Humorous_Elder',
  child: 'Chinese (Mandarin)_Cute_Spirit',
};

export async function synthesizeSpeech(params: {
  text: string;
  voiceType: VoiceType;
  speed?: number;
}): Promise<Buffer> {
  const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'speech-2.8-turbo',
      text: params.text,
      stream: false,
      voice_setting: {
        voice_id: VOICE_MAP[params.voiceType] || VOICE_MAP.narrator,
        speed: params.speed || 1.0,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 24000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  const result = await response.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax TTS error: ${result.base_resp?.status_msg || 'unknown'}`);
  }

  if (!result.data?.audio) {
    throw new Error('MiniMax TTS: no audio data in response');
  }

  return Buffer.from(result.data.audio, 'hex');
}
