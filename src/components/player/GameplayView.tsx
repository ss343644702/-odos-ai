'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { getDisplayFrames } from '@/types/story';
import ChoicePanel from './ChoicePanel';
import CustomInput from './CustomInput';
import NarrationPlayer from './NarrationPlayer';
import ButterflyLoading from './ButterflyLoading';
import type { NarrationPlayerHandle } from './NarrationPlayer';
import { useRouter } from 'next/navigation';

/** Check if a node is a stub that prefetch hasn't filled yet */
function isStubNode(node: any): boolean {
  if (!node) return false;
  // A stub has no real content: no narration AND no voiceSegments
  // Only check ai_generated nodes (mainline nodes are never stubs)
  if (node.type !== 'ai_generated' && node.type !== 'ending') return false;
  const hasNarration = !!node.data?.narration;
  const hasVoice = (node.data?.voiceSegments?.length ?? 0) > 0;
  return !hasNarration && !hasVoice;
}

/** Check if a node has core content ready (narration + voice). Images are optional — don't block navigation. */
function isNodeReady(node: any): boolean {
  if (!node) return false;
  // Non-AI nodes (authored mainline: start, scene, ending) are always ready
  if (node.type !== 'ai_generated') return true;
  if (!node.data?.narration) return false;
  if (!(node.data?.voiceSegments?.length > 0)) return false;
  return true;
}

export default function GameplayView({ isPreview = false }: { isPreview?: boolean }) {
  const router = useRouter();
  const currentNode = usePlayerStore((s) => s.currentNode);
  const story = usePlayerStore((s) => s.story);
  const session = usePlayerStore((s) => s.session);
  const isBranching = usePlayerStore((s) => s.isBranching);
  const goBack = usePlayerStore((s) => s.goBack);

  const [displayedText, setDisplayedText] = useState('');
  const [showChoices, setShowChoices] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [narrationDone, setNarrationDone] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [waitingForNode, setWaitingForNode] = useState(false);
  const [waitingChoiceText, setWaitingChoiceText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const waitingPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typewriterRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const narrationRef = useRef<NarrationPlayerHandle>(null);

  const voiceSegments = currentNode?.data.voiceSegments || [];
  const frames = currentNode ? getDisplayFrames(currentNode.data) : [];

  // Map segment index to a frame index
  const getFrameIndexForSegment = (segIdx: number): number => {
    if (frames.length <= 1) return 0;
    return Math.min(
      Math.floor(segIdx * frames.length / Math.max(voiceSegments.length, 1)),
      frames.length - 1
    );
  };

  // When voice segments exist, map segment → frame. When no voice, use segment index directly as frame index.
  const currentFrameIndex = voiceSegments.length > 0
    ? getFrameIndexForSegment(currentSegmentIndex)
    : Math.min(currentSegmentIndex, frames.length - 1);
  const currentFrame = frames[currentFrameIndex] || null;
  const currentImage = currentFrame?.imageUrl || currentNode?.data.imageUrl || undefined;
  const currentMediaType = (currentFrame as any)?.mediaType || 'image';
  const currentMediaUrl = (currentFrame as any)?.mediaUrl || null;

  // Video-voice sync: both must complete before advancing to next frame
  const videoEndedRef = useRef(false);
  const voiceDoneForFrameRef = useRef(false);
  const pendingSegmentRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Helper: try to advance to next frame if both video and voice are done
  const tryAdvanceFrame = () => {
    if (!videoEndedRef.current || !voiceDoneForFrameRef.current) return;
    if (pendingSegmentRef.current !== null) {
      const nextSeg = pendingSegmentRef.current;
      pendingSegmentRef.current = null;
      setCurrentSegmentIndex(nextSeg);
      // Resume narration from the next frame's first segment
      setTimeout(() => narrationRef.current?.playFromSegment(nextSeg), 100);
    } else if (currentFrameIndex >= frames.length - 1) {
      setShowChoices(true);
    }
  };

  // Reset sync state on frame change (or initial load)
  const prevFrameIndexRef = useRef<number | null>(null);
  if (currentFrameIndex !== prevFrameIndexRef.current) {
    prevFrameIndexRef.current = currentFrameIndex;
    videoEndedRef.current = currentMediaType !== 'video'; // non-video → already "ended"
    voiceDoneForFrameRef.current = voiceSegments.length === 0; // no voice → already "done"
    pendingSegmentRef.current = null;
  }

  const currentText = voiceSegments.length > 0
    ? (voiceSegments[currentSegmentIndex]?.text || '')
    : (currentNode?.data.narration || '');

  // Navigation counter — increments on every node transition (handles circular A→B→A)
  // Reset state synchronously during render to avoid flash of stale content
  const navCountRef = useRef(0);
  const prevNodeIdRef = useRef<string | undefined>(undefined); // Start as undefined so first render triggers reset
  if (currentNode?.id !== prevNodeIdRef.current) {
    navCountRef.current++;
    prevNodeIdRef.current = currentNode?.id;
    // Synchronous reset — prevents flash of old segment before useEffect fires
    if (currentSegmentIndex !== 0) setCurrentSegmentIndex(0);
    if (displayedText !== '') setDisplayedText('');
    if (isTyping) setIsTyping(false);
    if (waitingForNode) setWaitingForNode(false);
  }
  const navCount = navCountRef.current;

  // Additional reset effects that need to run after render (narration/voice detection)
  useEffect(() => {
    const hasVoice = (currentNode?.data.voiceSegments?.length ?? 0) > 0;
    const hasNarration = !!(currentNode?.data.narration);
    setNarrationDone(!hasVoice);
    if (!hasNarration && !hasVoice) {
      setShowChoices(true);
    } else {
      setShowChoices(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navCount]);

  // Typewriter effect
  useEffect(() => {
    if (!currentNode || !currentText) return;
    setDisplayedText('');
    setIsTyping(true);
    let idx = 0;
    const type = () => {
      if (idx < currentText.length) {
        setDisplayedText(currentText.slice(0, idx + 1));
        idx++;
        typewriterRef.current = setTimeout(type, 40);
      } else {
        setIsTyping(false);
      }
    };
    type();
    return () => { if (typewriterRef.current) clearTimeout(typewriterRef.current); };
  }, [currentNode?.id, currentSegmentIndex]);

  const handleSegmentChange = useCallback((segIndex: number) => {
    const nextFrameIdx = frames.length > 1
      ? Math.min(Math.floor(segIndex * frames.length / Math.max(voiceSegments.length, 1)), frames.length - 1)
      : 0;
    const curFrameIdx = frames.length > 1
      ? Math.min(Math.floor(currentSegmentIndex * frames.length / Math.max(voiceSegments.length, 1)), frames.length - 1)
      : 0;

    if (nextFrameIdx !== curFrameIdx) {
      // Voice reached next frame — pause narration, mark done, wait for video
      narrationRef.current?.stop();
      voiceDoneForFrameRef.current = true;
      pendingSegmentRef.current = segIndex;
      tryAdvanceFrame();
      return;
    }

    setCurrentSegmentIndex(segIndex);
    if (segIndex < (voiceSegments.length - 1)) {
      setShowChoices(false);
    }
  }, [voiceSegments.length, frames.length, currentSegmentIndex]);

  const handleNarrationEnd = useCallback(() => {
    setNarrationDone(true);
    // All voice segments done — mark voice done for current frame and try advance
    voiceDoneForFrameRef.current = true;
    if (currentFrameIndex < frames.length - 1) {
      // Find first segment of next frame
      const nextSeg = voiceSegments.findIndex((_, i) => getFrameIndexForSegment(i) > currentFrameIndex);
      pendingSegmentRef.current = nextSeg >= 0 ? nextSeg : currentFrameIndex + 1;
      tryAdvanceFrame();
    } else {
      tryAdvanceFrame();
    }
  }, [currentFrameIndex, frames.length, voiceSegments]);

  // Show choices only when narration done, typewriter finished, last segment, and no video still playing
  useEffect(() => {
    if (isTyping || !narrationDone) return;
    const isLastSegment = voiceSegments.length === 0 || currentSegmentIndex >= voiceSegments.length - 1;
    const isLastFrame = currentFrameIndex >= frames.length - 1;
    const lastFrameIsVideo = isLastFrame && currentMediaType === 'video';
    // If last frame is a video, let tryAdvanceFrame/onEnded handle showChoices instead
    if (isLastSegment && isLastFrame && !lastFrameIsVideo) {
      setShowChoices(true);
    }
  }, [isTyping, narrationDone, currentSegmentIndex, voiceSegments.length, currentFrameIndex, frames.length, currentMediaType]);

  // Skip / advance
  const handleTap = useCallback(() => {
    if (!currentNode || showChoices) return;
    if (typewriterRef.current) clearTimeout(typewriterRef.current);
    narrationRef.current?.stop();
    // Stop video if playing
    if (videoRef.current) { videoRef.current.pause(); }
    videoEndedRef.current = true;
    voiceDoneForFrameRef.current = true;
    pendingSegmentRef.current = null;
    const lastText = voiceSegments.length > 0
      ? voiceSegments[voiceSegments.length - 1].text
      : (currentNode.data.narration || '');
    setDisplayedText(lastText);
    if (voiceSegments.length > 0) setCurrentSegmentIndex(voiceSegments.length - 1);
    setIsTyping(false);
    setNarrationDone(true);
    setShowChoices(true);
  }, [currentNode, showChoices, voiceSegments]);

  const navigateToNode = usePlayerStore((s) => s.navigateToNode);

  /** On-demand generate a single node with retry */
  const generateOnDemand = useCallback(async (targetNodeId: string) => {
    const storyState = usePlayerStore.getState().story;
    const freshNode = storyState?.nodes.find((n) => n.id === targetNodeId);
    if (!freshNode) return false;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/branch-prefetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyId: storyState?.id,
            nodes: [freshNode],
            worldView: storyState?.worldView || '',
            mainPlotNodeIds: storyState?.nodes.filter((n) => n.type !== 'ai_generated').map((n) => n.id) || [],
            mainPlotNodes: storyState?.nodes.filter((n) => n.type !== 'ai_generated').map((n) => ({
              id: n.id, type: n.type, title: n.data.title, narration: n.data.narration?.slice(0, 100),
            })) || [],
            style: storyState?.style || null,
            entities: null,
            defaultVoice: storyState?.settings?.defaultVoice || 'narrator',
            branchDepth: 1,
            convergenceTarget: storyState?.nodes.filter((n) => n.type !== 'ai_generated').map((n) => n.id)?.[0] || '',
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const completed of (data.completedNodes || [])) {
          usePlayerStore.getState().updateGeneratedNode(completed.nodeId, completed.data);
        }
        const newExtras = data.newExtraNodes || [];
        if (newExtras.length > 0) {
          const existing = usePlayerStore.getState().story?.nodes || [];
          const fresh = newExtras.filter((n: any) => !existing.some((en: any) => en.id === n.id));
          if (fresh.length > 0) usePlayerStore.getState().addGeneratedNodes(fresh);
        }
        return true;
      } catch {
        if (attempt >= 2) return false;
      }
    }
    return false;
  }, []);

  // Cancel all in-flight generation (polling, prefetch, etc.)
  const cancelAllGeneration = useCallback(() => {
    if (waitingPollRef.current) { clearInterval(waitingPollRef.current); waitingPollRef.current = undefined; }
    if (waitingTimerRef.current) { clearTimeout(waitingTimerRef.current); waitingTimerRef.current = undefined; }
    setWaitingForNode(false);
    usePlayerStore.getState().setBranching(false);
  }, []);

  // Handle choice selection — check if target is a stub, wait if needed
  const handleChoose = useCallback((choiceId: string) => {
    const state = usePlayerStore.getState();
    const node = state.currentNode;
    if (!node) return;

    const choice = node.data.choices?.find((c: any) => c.id === choiceId);
    if (!choice) return;

    const targetNodeId = choice.targetNodeId;
    const targetNode = state.story?.nodes?.find((n) => n.id === targetNodeId);

    // If target node has ALL content ready (narration + voice + images), navigate immediately
    if (targetNode && isNodeReady(targetNode)) {
      navigateToNode(targetNodeId, choice.text);
      return;
    }

    // Target not fully ready — show ButterflyLoading and poll until complete
    setWaitingForNode(true);
    setWaitingChoiceText(choice.text || '');
    let onDemandStarted = false;

    const poll = setInterval(() => {
      const fresh = usePlayerStore.getState().story?.nodes?.find((n) => n.id === targetNodeId);
      if (fresh && isNodeReady(fresh)) {
        clearInterval(poll);
        clearTimeout(onDemandTimer);
        setWaitingForNode(false);
        waitingPollRef.current = undefined;
        waitingTimerRef.current = undefined;
        usePlayerStore.getState().navigateToNode(targetNodeId, choice.text);
      }
    }, 500);
    waitingPollRef.current = poll;

    // After 15s, start on-demand generation if still waiting
    const onDemandTimer = setTimeout(async () => {
      if (onDemandStarted) return;
      onDemandStarted = true;
      const ok = await generateOnDemand(targetNodeId);
      // After on-demand completes, check again
      const fresh = usePlayerStore.getState().story?.nodes?.find((n) => n.id === targetNodeId);
      if (fresh && isNodeReady(fresh)) {
        clearInterval(poll);
        setWaitingForNode(false);
        usePlayerStore.getState().navigateToNode(targetNodeId, choice.text);
      } else if (!ok) {
        // All retries failed — keep polling, on-demand already tried
      }
    }, 15000);
    waitingTimerRef.current = onDemandTimer;
  }, [navigateToNode, generateOnDemand]);

  const isEnding = currentNode?.type === 'ending';

  // Achievement tracking: two badges per story, each only once, saved to server + localStorage
  // Must be before any early return to respect React hooks order
  useEffect(() => {
    if (!isEnding || !story || !session || !currentNode) return;

    const isHidden = currentNode.data.metadata?.endingType === 'hidden'
      || currentNode.data.metadata?.endingType === 'best'
      || currentNode.data.metadata?.tags?.includes('hidden_ending')
      || currentNode.data.metadata?.tags?.includes('best_ending');

    const badge = isHidden ? 'hiddenUnlocked' : 'completed';
    const existing = JSON.parse(localStorage.getItem(`achievements_${story.id}`) || '{}');
    if (existing[badge]) return; // already marked

    const updated = { ...existing, [badge]: true };
    localStorage.setItem(`achievements_${story.id}`, JSON.stringify(updated));
    fetch(`/api/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ achievements: updated }),
    }).catch(() => {});
  }, [isEnding, story, session, currentNode]);

  if (!currentNode || !story) {
    const hasNodes = (story?.nodes || []).filter(n => n.type !== 'story_config').length > 0;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
        {story && !hasNodes ? (
          <>
            <div className="text-3xl opacity-30">🎬</div>
            <p className="text-sm">还没有可播放的节点</p>
            <p className="text-xs">请先在编辑器中创建故事内容</p>
          </>
        ) : (
          <span>加载中...</span>
        )}
      </div>
    );
  }

  const progress = session ? (session.history.length / ((story.nodes?.length || 1) * 0.6)) * 100 : 0;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Progress bar */}
      <div className="w-full h-1" style={{ background: 'var(--bg-tertiary)' }}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${Math.min(progress, 100)}%`, background: 'var(--accent)' }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-3">
        {!isPreview && (
          <button
            onClick={() => { cancelAllGeneration(); router.push('/discover'); }}
            className="p-1.5 rounded-full transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            title="返回主页"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <span className="text-sm font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{story.title}</span>
        {session && session.history.length > 0 && (
          <button onClick={() => { cancelAllGeneration(); goBack(); }} className="p-1.5 rounded-full" style={{ color: 'var(--text-secondary)' }} title="撤回上一步">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
        )}
        <button
          onClick={() => {
            narrationRef.current?.toggleMute();
            setIsMuted((m) => !m);
          }}
          className="p-1.5 rounded-full"
          style={{ color: isMuted ? 'var(--danger)' : 'var(--text-secondary)' }}
          title={isMuted ? '取消静音' : '静音'}
        >
          {isMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      </div>

      {/* Story media (image / video / GIF) */}
      <div className="relative">
        {currentMediaType === 'video' && currentMediaUrl ? (
          <video
            ref={videoRef}
            key={currentMediaUrl}
            src={currentMediaUrl}
            className="w-full aspect-[4/3] object-cover"
            autoPlay playsInline muted={isMuted}
            onEnded={() => {
              videoEndedRef.current = true;
              // No voice segments → also mark voice done + set pending for next frame
              if (voiceSegments.length === 0 || !voiceSegments.some((s: any) => s.audioUrl)) {
                voiceDoneForFrameRef.current = true;
                if (currentFrameIndex < frames.length - 1) {
                  pendingSegmentRef.current = currentFrameIndex + 1;
                }
              }
              tryAdvanceFrame();
            }}
          />
        ) : currentMediaType === 'gif' && currentMediaUrl ? (
          <img src={currentMediaUrl} alt="" className="w-full aspect-[4/3] object-cover" />
        ) : (
          <div
            className="w-full aspect-[4/3] flex items-center justify-center transition-all duration-500"
            style={{
              background: currentImage
                ? `url(${currentImage}) center/cover`
                : 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
            }}
          >
            {!currentImage && <div className="text-5xl opacity-30">🎬</div>}
          </div>
        )}

        {voiceSegments.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {voiceSegments.map((_, i) => (
              <span
                key={i}
                onClick={() => {
                  setCurrentSegmentIndex(i);
                  setDisplayedText(voiceSegments[i]?.text || '');
                  setIsTyping(false);
                  // Hide choices when switching to non-last segment
                  if (i < voiceSegments.length - 1) {
                    setShowChoices(false);
                  }
                  narrationRef.current?.playFromSegment(i);
                }}
                className="w-2 h-2 rounded-full transition-all cursor-pointer"
                style={{
                  background: i === currentSegmentIndex ? 'var(--accent)' : 'rgba(0,0,0,0.15)',
                  transform: i === currentSegmentIndex ? 'scale(1.3)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Narration Player */}
      <NarrationPlayer
        ref={narrationRef}
        nodeId={currentNode.id}
        voiceSegments={voiceSegments}
        onEnd={handleNarrationEnd}
        onSegmentChange={handleSegmentChange}
      />

      {/* Skip button */}
      {!showChoices && currentNode && (
        <div className="flex justify-end px-5 pt-2">
          <button
            onClick={handleTap}
            className="px-3 py-1 rounded-full text-[11px] transition-opacity"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            跳过 ▶▶
          </button>
        </div>
      )}

      {/* Text content */}
      <div className="flex-1 px-5 py-4">
        {currentNode.data.dialogue && currentNode.data.character && showChoices && (
          <div className="mb-4">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {currentNode.data.character}
            </span>
            <p
              className="mt-2 text-sm italic leading-relaxed"
              style={{ color: 'var(--text-primary)', borderLeft: '2px solid var(--accent)', paddingLeft: 12 }}
            >
              {currentNode.data.dialogue}
            </p>
          </div>
        )}

        {/* Speaker label for character segments */}
        {voiceSegments[currentSegmentIndex]?.speaker &&
         voiceSegments[currentSegmentIndex].speaker !== 'narrator' && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded mb-2 inline-block"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            {voiceSegments[currentSegmentIndex].speaker}
          </span>
        )}
        <p
          className={`text-sm leading-relaxed ${isTyping ? 'cursor-blink' : ''}`}
          style={{
            color: 'var(--text-primary)',
            fontStyle: voiceSegments[currentSegmentIndex]?.speaker && voiceSegments[currentSegmentIndex].speaker !== 'narrator' ? 'italic' : 'normal',
            borderLeft: voiceSegments[currentSegmentIndex]?.speaker && voiceSegments[currentSegmentIndex].speaker !== 'narrator' ? '2px solid var(--accent)' : 'none',
            paddingLeft: voiceSegments[currentSegmentIndex]?.speaker && voiceSegments[currentSegmentIndex].speaker !== 'narrator' ? 12 : 0,
          }}
        >
          {displayedText}
        </p>

        {isEnding && showChoices && (
          <div className="mt-6 text-center">
            <div className="text-lg font-bold mb-2" style={{ color: 'var(--node-ending)' }}>
              {currentNode.data.title}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>— 故事结束 —</p>
            <button
              onClick={() => { if (story) usePlayerStore.getState().initSession(story); }}
              className="mt-4 px-6 py-2 rounded-lg text-sm"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              重新开始
            </button>
          </div>
        )}
      </div>

      {/* Choice panel */}
      {showChoices && !isEnding && (
        <div className="px-5 pb-6">
          {waitingForNode ? (
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
            >
              <ButterflyLoading prefix={waitingChoiceText} />
            </div>
          ) : (
            <>
              <ChoicePanel
                choices={isPreview
                  ? (currentNode.data.choices || [])
                  : (currentNode.data.choices || []).filter((c: any) => !c.visibility || c.visibility !== 'hidden')
                }
                onChoose={handleChoose}
                showHiddenBadge={isPreview}
              />
              {!isPreview && <CustomInput nodeId={currentNode.id} storyId={story.id} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
