import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/minimax-tts';
import { uploadAudio } from '@/lib/oss';

export async function POST(request: NextRequest) {
  try {
    const { text, voiceType, speed, nodeId } = await request.json();

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: '文本不能为空' }, { status: 400 });
    }

    // Clean stage directions and non-speech content before TTS
    const cleanedText = text
      .replace(/[（(][^）)]*[画外音旁白场景切换音效背景][^）)]*[）)]/g, '')
      .replace(/[\[【][^\]】]*[\]】]/g, '')
      .replace(/\*[^*]+\*/g, '')
      .replace(/——/g, '，')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleanedText) {
      return NextResponse.json({ success: false, error: '清理后文本为空' }, { status: 400 });
    }

    const audioBuffer = await synthesizeSpeech({
      text: cleanedText.slice(0, 10000), // MiniMax 限制 10000 字符
      voiceType: voiceType || 'narrator',
      speed,
    });

    const filename = `${nodeId || 'tts'}_${Date.now()}.mp3`;
    const audioUrl = await uploadAudio(audioBuffer, filename);

    return NextResponse.json({ success: true, audioUrl });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'TTS generation failed';
    console.error('TTS error:', errMsg);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  }
}
