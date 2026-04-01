'use client';

import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import type { VoiceSegment, VoiceType } from '@/types/story';

const voiceTypeConfig: Record<VoiceType, { label: string; pitch: number; rate: number }> = {
  narrator: { label: '旁白', pitch: 1.0, rate: 0.9 },
  young_male: { label: '少年', pitch: 1.1, rate: 1.0 },
  mature_male: { label: '男性', pitch: 0.8, rate: 0.9 },
  young_female: { label: '少女', pitch: 1.3, rate: 1.0 },
  mature_female: { label: '女性', pitch: 1.1, rate: 0.9 },
  elder: { label: '长者', pitch: 0.7, rate: 0.8 },
  child: { label: '孩童', pitch: 1.5, rate: 1.1 },
};

interface NarrationPlayerProps {
  nodeId: string;
  voiceSegments: VoiceSegment[];
  onEnd?: () => void;
  onSegmentChange?: (segmentIndex: number) => void;
}

export interface NarrationPlayerHandle {
  stop: () => void;
}

const NarrationPlayer = forwardRef<NarrationPlayerHandle, NarrationPlayerProps>(
  function NarrationPlayer({ nodeId, voiceSegments, onEnd, onSegmentChange }, ref) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState('');
    // Single persistent Audio element — prevents overlapping playback
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Monotonic session ID: incremented on every stop/play to invalidate stale callbacks
    const sessionRef = useRef(0);

    // Store callbacks in refs to avoid dependency chains
    const onEndRef = useRef(onEnd);
    useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

    const onSegmentChangeRef = useRef(onSegmentChange);
    useEffect(() => { onSegmentChangeRef.current = onSegmentChange; }, [onSegmentChange]);

    const voiceSegmentsRef = useRef(voiceSegments);
    useEffect(() => { voiceSegmentsRef.current = voiceSegments; }, [voiceSegments]);

    // Stop any current playback
    const stopAll = useCallback(() => {
      sessionRef.current++; // Invalidate all in-flight callbacks
      if (audioRef.current) {
        audioRef.current.onplay = null;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load(); // Release resources
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    }, []);


    // Play segments sequentially — preload next segments for gapless playback
    const preloadCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    const playSegments = useCallback(() => {
      stopAll();
      // Clear old preload cache
      preloadCacheRef.current.forEach((a) => { a.pause(); a.removeAttribute('src'); });
      preloadCacheRef.current.clear();

      const session = sessionRef.current; // Capture session for stale check

      const segments = voiceSegmentsRef.current;
      if (segments.length === 0) {
        onEndRef.current?.();
        return;
      }

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
      const useAudio = segmentsWithAudio.length > 0;

      if (useAudio) {
        // Preload all audio URLs upfront so there's no gap between segments
        const preloadAudio = (url: string): HTMLAudioElement => {
          const cached = preloadCacheRef.current.get(url);
          if (cached) return cached;
          const a = new Audio();
          a.preload = 'auto';
          a.src = url;
          preloadCacheRef.current.set(url, a);
          return a;
        };
        segmentsWithAudio.forEach((s) => { if (s.audioUrl) preloadAudio(s.audioUrl); });

        let segIdx = 0;

        const playNext = () => {
          if (sessionRef.current !== session) return; // Stale — stop
          if (segIdx >= segmentsWithAudio.length) {
            setIsPlaying(false);
            setCurrentSpeaker('');
            onEndRef.current?.();
            return;
          }
          const seg = segmentsWithAudio[segIdx];
          const realIdx = segments.indexOf(seg);
          const config = voiceTypeConfig[seg.voiceType] || voiceTypeConfig.narrator;

          onSegmentChangeRef.current?.(realIdx);

          // Use preloaded audio element directly
          const audio = preloadAudio(seg.audioUrl!);

          audio.onplay = () => {
            if (sessionRef.current !== session) { audio.pause(); return; }
            setCurrentSpeaker(`${config.label}${seg.speaker !== 'narrator' ? ` · ${seg.speaker}` : ''}`);
          };
          audio.onended = () => {
            if (sessionRef.current !== session) return;
            segIdx++;
            playNext();
          };
          audio.onerror = () => {
            if (sessionRef.current !== session) return;
            segIdx++;
            playNext();
          };
          audio.currentTime = 0;
          audio.play().catch(() => {
            if (sessionRef.current !== session) return;
            segIdx++;
            playNext();
          });
        };
        setIsPlaying(true);
        playNext();
      } else {
        // Fallback: Web Speech API
        if (typeof window === 'undefined' || !window.speechSynthesis) {
          onEndRef.current?.();
          return;
        }
        let segIdx = 0;
        const speakNext = () => {
          if (sessionRef.current !== session) return;
          if (segIdx >= segments.length) {
            setIsPlaying(false);
            setCurrentSpeaker('');
            onEndRef.current?.();
            return;
          }
          const seg = segments[segIdx];
          const config = voiceTypeConfig[seg.voiceType] || voiceTypeConfig.narrator;
          const utt = new SpeechSynthesisUtterance(seg.text);
          utt.lang = 'zh-CN';
          utt.pitch = config.pitch;
          utt.rate = config.rate * (seg.speed || 1);

          onSegmentChangeRef.current?.(segIdx);

          utt.onstart = () => setCurrentSpeaker(`${config.label}${seg.speaker !== 'narrator' ? ` · ${seg.speaker}` : ''}`);
          utt.onend = () => {
            if (sessionRef.current !== session) return;
            segIdx++;
            speakNext();
          };
          window.speechSynthesis.speak(utt);
        };
        setIsPlaying(true);
        speakNext();
      }
    }, [stopAll]);

    const stop = useCallback(() => {
      stopAll();
      // Stop all preloaded audio too
      preloadCacheRef.current.forEach((a) => { a.pause(); a.onended = null; a.onerror = null; });
      setIsPlaying(false);
      setCurrentSpeaker('');
      onEndRef.current?.();
    }, [stopAll]);

    const toggleMute = useCallback(() => {
      setIsMuted((m) => !m);
      if (!isMuted) {
        stop();
      }
    }, [isMuted, stop]);

    useImperativeHandle(ref, () => ({ stop }), [stop]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        sessionRef.current++;
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.removeAttribute('src');
          audioRef.current = null;
        }
        // Clean up preloaded audio
        preloadCacheRef.current.forEach((a) => { a.pause(); a.removeAttribute('src'); });
        preloadCacheRef.current.clear();
        if (typeof window !== 'undefined' && window.speechSynthesis) { window.speechSynthesis.cancel(); }
      };
    }, []);

    // Store play/stop in refs for auto-play effect
    const playRef = useRef(playSegments);
    useEffect(() => { playRef.current = playSegments; }, [playSegments]);

    const stopAllRef = useRef(stopAll);
    useEffect(() => { stopAllRef.current = stopAll; }, [stopAll]);

    // Auto-play on node change only
    useEffect(() => {
      stopAllRef.current();
      setIsPlaying(false);
      setCurrentSpeaker('');

      if (!isMuted && voiceSegmentsRef.current.length > 0) {
        // Small delay to ensure stopAll's session increment takes effect
        const timer = setTimeout(() => playRef.current(), 50);
        return () => { clearTimeout(timer); stopAllRef.current(); };
      } else {
        onEndRef.current?.();
      }
      return () => { stopAllRef.current(); };
    }, [nodeId, isMuted]);

    return (
      <div
        className="flex items-center gap-3 px-5 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Play/Pause */}
        <button
          onClick={isPlaying ? stop : playSegments}
          className="p-1.5 rounded-full transition-colors"
          style={{
            background: isPlaying ? 'var(--accent-dim)' : 'transparent',
            color: isPlaying ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        {/* Speaker indicator */}
        <div className="flex-1">
          {currentSpeaker ? (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
              <span className="text-[10px]" style={{ color: 'var(--accent)' }}>
                {currentSpeaker} 说话中
              </span>
            </div>
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              点击播放配音
            </span>
          )}
        </div>

        {/* Mute toggle */}
        <button
          onClick={toggleMute}
          className="p-1.5 rounded-full"
          style={{ color: isMuted ? 'var(--danger)' : 'var(--text-secondary)' }}
        >
          {isMuted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      </div>
    );
  }
);

export default NarrationPlayer;
