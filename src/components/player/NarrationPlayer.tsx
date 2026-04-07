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
  playFromSegment: (index: number) => void;
  toggleMute: () => void;
  isMuted: boolean;
}

const NarrationPlayer = forwardRef<NarrationPlayerHandle, NarrationPlayerProps>(
  function NarrationPlayer({ nodeId, voiceSegments, onEnd, onSegmentChange }, ref) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const isMutedRef = useRef(false);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
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

    // Stop any current playback (including preloaded audio)
    const stopAll = useCallback(() => {
      sessionRef.current++; // Invalidate all in-flight callbacks
      if (audioRef.current) {
        audioRef.current.onplay = null;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
      // Also stop all preloaded audio elements (the actual playing ones)
      preloadCacheRef.current.forEach((a) => {
        a.onplay = null;
        a.onended = null;
        a.onerror = null;
        a.pause();
      });
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    }, []);


    // Play segments sequentially — preload next segments for gapless playback
    const preloadCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    const playSegments = useCallback((startFromIndex = 0) => {
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

      const segmentsWithAudio = segments.filter((s, i) => s.audioUrl && i >= startFromIndex);
      const useAudio = segmentsWithAudio.length > 0;
      // Notify segment change immediately
      if (startFromIndex > 0) {
        onSegmentChangeRef.current?.(startFromIndex);
      }

      if (useAudio) {
        // Preload all audio URLs upfront so there's no gap between segments
        const preloadAudio = (url: string): HTMLAudioElement => {
          const cached = preloadCacheRef.current.get(url);
          if (cached) { cached.volume = isMutedRef.current ? 0 : 1; return cached; }
          const a = new Audio();
          a.preload = 'auto';
          a.volume = isMutedRef.current ? 0 : 1;
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
      setIsPlaying(false);
      setCurrentSpeaker('');
      // Note: do NOT call onEnd here — stop() is for manual pause/mute, not natural ending
    }, [stopAll]);

    const toggleMute = useCallback(() => {
      setIsMuted((m) => {
        const newMuted = !m;
        // Set volume on all active audio elements
        preloadCacheRef.current.forEach((a) => { a.volume = newMuted ? 0 : 1; });
        if (audioRef.current) audioRef.current.volume = newMuted ? 0 : 1;
        return newMuted;
      });
    }, []);

    useImperativeHandle(ref, () => ({
      stop,
      playFromSegment: (index: number) => {
        if (!isMuted) playSegments(index);
      },
      toggleMute,
      isMuted,
    }), [stop, isMuted, playSegments, toggleMute]);

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

    // Auto-play on node change only (mute is just volume, doesn't affect playback)
    useEffect(() => {
      stopAllRef.current();
      setIsPlaying(false);
      setCurrentSpeaker('');

      if (voiceSegmentsRef.current.length > 0) {
        const timer = setTimeout(() => playRef.current(), 50);
        return () => { clearTimeout(timer); stopAllRef.current(); };
      } else {
        onEndRef.current?.();
      }
      return () => { stopAllRef.current(); };
    }, [nodeId]);

    // Audio-only component — no visible UI (mute button moved to GameplayView top bar)
    return null;
  }
);

export default NarrationPlayer;
