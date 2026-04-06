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
  const typewriterRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const narrationRef = useRef<NarrationPlayerHandle>(null);

  const voiceSegments = currentNode?.data.voiceSegments || [];
  const frames = currentNode ? getDisplayFrames(currentNode.data) : [];

  // Map segment index to a frame for image display
  const getImageForSegment = (segIdx: number): string | undefined => {
    const fallback = currentNode?.data.imageUrl || undefined;
    if (frames.length === 0) return fallback;
    if (frames.length === 1) return frames[0].imageUrl || fallback;
    const frameIdx = Math.min(
      Math.floor(segIdx * frames.length / Math.max(voiceSegments.length, 1)),
      frames.length - 1
    );
    return frames[frameIdx]?.imageUrl || fallback;
  };

  const currentImage = voiceSegments.length > 0
    ? getImageForSegment(currentSegmentIndex)
    : (frames[0]?.imageUrl || currentNode?.data.imageUrl);

  const currentText = voiceSegments.length > 0
    ? (voiceSegments[currentSegmentIndex]?.text || '')
    : (currentNode?.data.narration || '');

  // Reset state when node changes (use history length to detect circular navigation A→B→A)
  const historyLen = session?.history?.length ?? 0;
  useEffect(() => {
    setCurrentSegmentIndex(0);
    setDisplayedText('');
    setIsTyping(false);
    setWaitingForNode(false);
    const hasVoice = (currentNode?.data.voiceSegments?.length ?? 0) > 0;
    const hasNarration = !!(currentNode?.data.narration);
    setNarrationDone(!hasVoice);
    // If no narration and no voice, show choices immediately
    if (!hasNarration && !hasVoice) {
      setShowChoices(true);
    } else {
      setShowChoices(false);
    }
  }, [currentNode?.id, historyLen]);

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
    setCurrentSegmentIndex(segIndex);
  }, []);

  const handleNarrationEnd = useCallback(() => {
    setNarrationDone(true);
  }, []);

  // Show choices when narration is done and typewriter finished
  useEffect(() => {
    if (isTyping || !narrationDone) return;
    setShowChoices(true);
  }, [isTyping, narrationDone]);

  // Skip / advance
  const handleTap = useCallback(() => {
    if (!currentNode || showChoices) return;
    if (typewriterRef.current) clearTimeout(typewriterRef.current);
    narrationRef.current?.stop();
    const lastText = voiceSegments.length > 0
      ? voiceSegments[voiceSegments.length - 1].text
      : (currentNode.data.narration || '');
    setDisplayedText(lastText);
    if (voiceSegments.length > 0) setCurrentSegmentIndex(voiceSegments.length - 1);
    setIsTyping(false);
    setNarrationDone(true);
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

  // Handle choice selection — check if target is a stub, wait if needed
  const handleChoose = useCallback((choiceId: string) => {
    const state = usePlayerStore.getState();
    const node = state.currentNode;
    if (!node) return;

    const choice = node.data.choices?.find((c: any) => c.id === choiceId);
    if (!choice) return;

    const targetNodeId = choice.targetNodeId;
    const targetNode = state.story?.nodes?.find((n) => n.id === targetNodeId);

    // If target node has full content, navigate immediately
    if (targetNode && !isStubNode(targetNode)) {
      navigateToNode(targetNodeId, choice.text);
      return;
    }

    // Target doesn't exist or is a stub — show loading and poll
    setWaitingForNode(true);
    let onDemandStarted = false;

    const poll = setInterval(() => {
      const fresh = usePlayerStore.getState().story?.nodes?.find((n) => n.id === targetNodeId);
      if (fresh && !isStubNode(fresh)) {
        clearInterval(poll);
        clearTimeout(onDemandTimer);
        setWaitingForNode(false);
        usePlayerStore.getState().navigateToNode(targetNodeId, choice.text);
      }
    }, 500);

    // After 15s, start on-demand generation if still waiting
    const onDemandTimer = setTimeout(async () => {
      if (onDemandStarted) return;
      onDemandStarted = true;
      const ok = await generateOnDemand(targetNodeId);
      // After on-demand completes, check again
      const fresh = usePlayerStore.getState().story?.nodes?.find((n) => n.id === targetNodeId);
      if (fresh && !isStubNode(fresh)) {
        clearInterval(poll);
        setWaitingForNode(false);
        usePlayerStore.getState().navigateToNode(targetNodeId, choice.text);
      } else if (!ok) {
        // All retries failed — keep polling, on-demand already tried
      }
    }, 15000);
  }, [navigateToNode, generateOnDemand]);

  if (!currentNode || !story) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        加载中...
      </div>
    );
  }

  const isEnding = currentNode.type === 'ending';
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
            onClick={() => router.push('/discover')}
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
          <button onClick={goBack} className="p-1.5 rounded-full" style={{ color: 'var(--text-secondary)' }} title="撤回上一步">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
        )}
      </div>

      {/* Story image */}
      <div className="relative">
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

        {voiceSegments.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {voiceSegments.map((_, i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full transition-all"
                style={{
                  background: i === currentSegmentIndex ? 'white' : 'rgba(255,255,255,0.4)',
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

        <p
          className={`text-sm leading-relaxed ${isTyping ? 'cursor-blink' : ''}`}
          style={{ color: 'var(--text-primary)' }}
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
              <ButterflyLoading />
            </div>
          ) : (
            <>
              <ChoicePanel
                choices={currentNode.data.choices || []}
                onChoose={handleChoose}
              />
              <CustomInput nodeId={currentNode.id} storyId={story.id} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
