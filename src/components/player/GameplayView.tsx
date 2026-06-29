'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { getDisplayFrames, buildStoryline } from '@/types/story';
import ChoicePanel from './ChoicePanel';
import CustomInput from './CustomInput';
import NarrationPlayer from './NarrationPlayer';
import ButterflyLoading from './ButterflyLoading';
import StoryProgressPanel, { ENDING_META } from './StoryProgressPanel';
import { getEntityImageList } from '@/lib/entity-utils';
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

/**
 * Order voice segments to match frame order, AND drop orphans so playback matches the editor panel.
 *
 * Two things happen here:
 *  1. Ordering: addVoiceSegment appends new segments to the end, so a segment added to an earlier
 *     frame can sit after later frames' segments — playback follows array order, so without sorting
 *     it would play (and jump the visual back) after later frames.
 *  2. Orphan removal: a segment whose frameId matches no current frame (e.g. frames were regenerated
 *     with new ids while old segments kept stale frameIds) is INVISIBLE in the per-frame editor panel
 *     (getSegmentsOfFrame only keeps frameId === frame.id) but, in the old logic, was mapped to
 *     `frames.length` and played at the very end. We now drop these so playback == what the panel shows.
 *
 * Anchored mode (some segment has a frameId) only applies with ≥2 frames — with 0/1 frame the panel
 * shows every segment, so we leave them untouched. Returns the original array reference when nothing
 * changed to avoid render churn.
 */
function orderSegmentsByFrame(segs: any[], frames: any[]): any[] {
  if (frames.length <= 1 || segs.length <= 1) return segs;
  const order = new Map(frames.map((f: any, i: number) => [f.id, i]));
  const anchored = segs.some((s: any) => s.frameId);
  // In anchored mode, keep only segments that belong to an existing frame (mirror getSegmentsOfFrame).
  const kept = anchored ? segs.filter((s: any) => s.frameId && order.has(s.frameId)) : segs;
  const idxOf = (s: any) => (order.has(s.frameId) ? (order.get(s.frameId) as number) : frames.length);
  const keyed = kept.map((s, i) => ({ s, i }));
  keyed.sort((a, b) => (idxOf(a.s) - idxOf(b.s)) || (a.i - b.i)); // stable: frame order, then original order
  const result = keyed.map((x) => x.s);
  // Preserve reference identity when nothing was dropped or reordered.
  if (result.length === segs.length && result.every((s, i) => s === segs[i])) return segs;
  return result;
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
  const [waitFailed, setWaitFailed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const waitingPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typewriterRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const narrationRef = useRef<NarrationPlayerHandle>(null);

  const frames = currentNode ? getDisplayFrames(currentNode.data) : [];
  const voiceSegments = orderSegmentsByFrame(currentNode?.data.voiceSegments || [], frames);

  // Map a segment index to its frame index.
  // Prefer the segment's frameId anchor (set at generation time). Fall back to the
  // boundary search that mirrors syncFramesFromVoice for legacy data without anchors.
  const getFrameIndexForSegment = (segIdx: number): number => {
    const F = frames.length;
    if (F <= 1) return 0;
    const anchorId = voiceSegments[segIdx]?.frameId;
    if (anchorId) {
      const fi = frames.findIndex((f: any) => f.id === anchorId);
      if (fi >= 0) return fi;
    }
    const V = Math.max(voiceSegments.length, 1);
    for (let i = F - 1; i >= 0; i--) {
      if (Math.floor(i * V / F) <= segIdx) return i;
    }
    return 0;
  };

  // When voice segments exist, map segment → frame. When no voice, use segment index directly as frame index.
  const currentFrameIndex = voiceSegments.length > 0
    ? getFrameIndexForSegment(currentSegmentIndex)
    : Math.min(currentSegmentIndex, frames.length - 1);
  const currentFrame = frames[currentFrameIndex] || null;
  const currentImage = currentFrame?.imageUrl || currentNode?.data.imageUrl || undefined;
  const currentMediaType = (currentFrame as any)?.mediaType || 'image';
  const currentMediaUrl = (currentFrame as any)?.mediaUrl || null;
  // A deferred frame whose image hasn't filled yet: it has its own imagePrompt but no imageUrl/media.
  // We must NOT keep showing the previous frame's image for it (that's the "几个配音都是同一张图"
  // symptom) — render a "生成中" hold instead until updateFrameImage backfills it.
  const currentFramePending = !!currentFrame
    && !currentFrame.imageUrl
    && !(currentFrame as any).mediaUrl
    && !!currentFrame.imagePrompt
    && currentFrameIndex > 0;

  // Eliminate white flash on image switch: only show an image once it's fully decoded,
  // keeping the previous one visible meanwhile (no gap that exposes the page background).
  const [shownImage, setShownImage] = useState<string | undefined>(currentImage);
  useEffect(() => {
    if (!currentImage) { setShownImage(undefined); return; }
    const img = new Image();
    img.src = currentImage;
    if (img.complete) { setShownImage(currentImage); return; }
    let cancelled = false;
    img.onload = () => { if (!cancelled) setShownImage(currentImage); };
    return () => { cancelled = true; };
  }, [currentImage]);

  // Preload all frame images of the current node so frame-to-frame switches are instant.
  useEffect(() => {
    const urls = (frames || []).map((f: any) => f?.imageUrl).filter(Boolean);
    if (currentNode?.data?.imageUrl) urls.push(currentNode.data.imageUrl);
    urls.forEach((u: string) => { const img = new Image(); img.src = u; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode?.id]);

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
    } else if (currentSegmentIndex >= voiceSegments.length - 1) {
      // No more segments queued and we're on the last one → node is done
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
    setWaitFailed(false); // clear any stale "generation failed" state from the previous node
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
    // Same boundary logic as getFrameIndexForSegment / syncFramesFromVoice (kept inline
    // so this useCallback doesn't depend on a per-render function identity).
    const frameOf = (seg: number): number => {
      const F = frames.length;
      if (F <= 1) return 0;
      const anchorId = voiceSegments[seg]?.frameId;
      if (anchorId) {
        const fi = frames.findIndex((f: any) => f.id === anchorId);
        if (fi >= 0) return fi;
      }
      const V = Math.max(voiceSegments.length, 1);
      for (let i = F - 1; i >= 0; i--) {
        if (Math.floor(i * V / F) <= seg) return i;
      }
      return 0;
    };
    const nextFrameIdx = frameOf(segIndex);
    const curFrameIdx = frameOf(currentSegmentIndex);

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
    // All voice segments have finished playing → the node is done. Terminate on the LAST
    // SEGMENT, not the last frame: segment frameIds can be out of order / not end on the last
    // frame (from edits), so a frame-based check could stall and loop forever.
    voiceDoneForFrameRef.current = true;
    videoEndedRef.current = true;
    pendingSegmentRef.current = null;
    setShowChoices(true);
  }, []);

  // Show choices once narration + typewriter are done on the last SEGMENT.
  // Terminate on segment (linear), not frame: out-of-order/incomplete frame anchors must not stall.
  useEffect(() => {
    if (isTyping || !narrationDone) return;
    const isLastSegment = voiceSegments.length === 0 || currentSegmentIndex >= voiceSegments.length - 1;
    const isLastFrame = currentFrameIndex >= frames.length - 1;
    const lastFrameIsVideo = isLastFrame && currentMediaType === 'video';
    // If the current frame is a video, let tryAdvanceFrame/onEnded handle showChoices instead
    if (isLastSegment && !lastFrameIsVideo) {
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
            // Linear story-so-far up to the current node (from history) — excludes abandoned branches.
            storyline: buildStoryline(
              storyState?.nodes || [],
              usePlayerStore.getState().session?.history || [],
              usePlayerStore.getState().currentNode?.id || '',
            ),
            worldView: storyState?.worldView || '',
            mainPlotNodeIds: storyState?.nodes.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => n.id) || [],
            mainPlotNodes: storyState?.nodes.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => ({
              id: n.id, type: n.type, title: n.data.title, narration: n.data.narration,
            })) || [],
            style: storyState?.style || null,
            entities: storyState?.entities || null,
            defaultVoice: storyState?.settings?.defaultVoice || 'narrator',
            branchDepth: 1,
            // story-config is nodes[0]; it must NOT be a convergence target or 继续 lands on a
            // blank config node (white screen). Exclude it like the decision path already does.
            convergenceTarget: storyState?.nodes.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => n.id)?.[0] || '',
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
    setWaitFailed(false);
    usePlayerStore.getState().setBranching(false);
  }, []);

  // Generate ONE frame's image (submit + poll), writing it into the store. Bounded by timeoutMs.
  // Used at click time: prefetch now generates content + voice but NOT images, so the chosen
  // option's first-frame image is produced here — the only thing the player waits on.
  const generateFrameImage = useCallback(async (nodeId: string, frame: any, timeoutMs = 20000) => {
    const st = usePlayerStore.getState();
    const ents = st.story?.entities || null;
    const node = st.story?.nodes?.find((n) => n.id === nodeId);
    try {
      const imageList = ents ? getEntityImageList(ents as any, frame?.entityRefs, node?.data.character ?? null) : [];
      const subRes = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: frame?.imagePrompt, aspectRatio: '9:16', image_list: imageList.length > 0 ? imageList : undefined }),
      });
      const sub = await subRes.json();
      if (!sub?.taskId) return false;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const pollRes = await fetch(`/api/generate-image?taskId=${encodeURIComponent(sub.taskId)}`);
        const pd = await pollRes.json();
        if (pd?.status === 'completed' && pd.imageUrl) {
          usePlayerStore.getState().updateFrameImage(nodeId, frame.id, pd.imageUrl);
          return true;
        }
        if (pd?.status === 'failed' || pd?.status === 'moderated' || pd?.status === 'timeout') return false;
      }
    } catch { /* ignore — caller enters with the black fallback */ }
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

    // Content ready (narration + voice)? Prefetch already produced it — the only thing left is the
    // first-frame image. Generate it now (brief wait), THEN enter. Later frames fill afterwards.
    if (targetNode && isNodeReady(targetNode)) {
      const firstFrame = (targetNode.data.frames || [])[0] as any;
      const needsImage = firstFrame && !firstFrame.imageUrl && !firstFrame.mediaUrl && firstFrame.imagePrompt;
      if (!needsImage) {
        navigateToNode(targetNodeId, choice.text);
        return;
      }
      setWaitFailed(false);
      setWaitingForNode(true);
      setWaitingChoiceText(choice.text || '');
      (async () => {
        await generateFrameImage(targetNodeId, firstFrame, 20000);
        // Enter regardless of outcome — a missing image just shows the black backdrop and the
        // deferred-fill effect keeps trying; never block the player on image generation.
        setWaitingForNode(false);
        usePlayerStore.getState().navigateToNode(targetNodeId, choice.text);
      })();
      return;
    }

    // Target not fully ready — show ButterflyLoading and poll until complete
    setWaitFailed(false);
    setWaitingForNode(true);
    setWaitingChoiceText(choice.text || '');
    const startedAt = Date.now();
    const HARD_CAP_MS = 60000; // give up after 60s of waiting (incl. on-demand retries)
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
        return;
      }
      // Hard cap: a node that never becomes ready (e.g. generation kept failing) must not spin
      // forever. Stop, drop back to the choices, and let the player retry instead of hanging.
      if (Date.now() - startedAt > HARD_CAP_MS) {
        clearInterval(poll);
        clearTimeout(onDemandTimer);
        waitingPollRef.current = undefined;
        waitingTimerRef.current = undefined;
        setWaitingForNode(false);
        setWaitFailed(true);
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
  }, [navigateToNode, generateOnDemand, generateFrameImage]);

  const isEnding = currentNode?.type === 'ending';

  // Achievement + ending-unlock tracking. Records the reached ending (for the Story Progress
  // medals) and the two per-story badges, persisted to localStorage AND the server session.
  // Must be before any early return to respect React hooks order.
  useEffect(() => {
    if (!isEnding || !story || !session || !currentNode) return;

    const isHidden = currentNode.data.metadata?.endingType === 'hidden'
      || currentNode.data.metadata?.endingType === 'best'
      || currentNode.data.metadata?.tags?.includes('hidden_ending')
      || currentNode.data.metadata?.tags?.includes('best_ending');
    const badge = isHidden ? 'hiddenUnlocked' : 'completed';

    const key = `achievements_${story.id}`;
    const existing = JSON.parse(localStorage.getItem(key) || '{}');
    const unlocked = new Set<string>(Array.isArray(existing.unlockedEndings) ? existing.unlockedEndings : []);
    const newUnlock = !unlocked.has(currentNode.id);
    const newBadge = !existing[badge];
    if (!newUnlock && !newBadge) return; // nothing changed

    unlocked.add(currentNode.id);
    const updated = { ...existing, [badge]: true, unlockedEndings: [...unlocked] };
    localStorage.setItem(key, JSON.stringify(updated));
    localStorage.setItem(`unlockedEndings_${story.id}`, JSON.stringify([...unlocked]));
    fetch(`/api/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ achievements: updated }),
    }).catch(() => {});
  }, [isEnding, story, session, currentNode]);

  // Persist progress (history + position) to the server session on every navigation.
  useEffect(() => {
    if (!session?.id) return;
    fetch(`/api/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: session.history, currentNodeId: session.currentNodeId }),
    }).catch(() => {});
  }, [session?.id, session?.history.length, session?.currentNodeId]);

  // Persist the full set of dynamic (AI-generated) nodes to the session. These come from BOTH
  // custom-input branching AND prefetch/on-demand generation (e.g. `ai_bridge_*` bridge nodes).
  // Without this, bridge nodes live only in memory and vanish on reload/restore — which strands
  // `goBack` (its history step points at a node no longer in story.nodes). The signature includes
  // a readiness flag per node so a stub that later gets filled by prefetch is re-persisted.
  //
  // It also counts frames that already have an image (`imgFilled`): deferred frame images are
  // generated client-side AFTER the node arrives (only frame 0 is rendered server-side), and
  // updateFrameImage writes them into the store. Without imgFilled in the signature, those later
  // images never re-persist, so on reload every segment of the node falls back to frame 0's image
  // (symptom: "后面几个配音都是同一张图").
  const dynamicNodeSig = (story?.nodes || [])
    .filter((n) => n.type === 'ai_generated')
    .map((n) => {
      const frames = n.data.frames || [];
      const imgFilled = frames.filter((f: any) => f.imageUrl || f.mediaUrl).length;
      return `${n.id}:${n.data.narration ? 1 : 0}${n.data.voiceSegments?.length ? 1 : 0}${frames.length}:${imgFilled}`;
    })
    .join('|');
  useEffect(() => {
    if (!session?.id) return;
    const st = usePlayerStore.getState().story;
    if (!st) return;
    const dynamicNodes = (st.nodes || []).filter((n) => n.type === 'ai_generated');
    if (dynamicNodes.length === 0) return;
    const dynIds = new Set(dynamicNodes.map((n) => n.id));
    const dynamicEdges = (st.edges || []).filter((e: any) => dynIds.has(e.source) || dynIds.has(e.target));
    fetch(`/api/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dynamicNodes, dynamicEdges }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, dynamicNodeSig]);

  // Create a fresh DB session row for the current local session (used on replay/restart).
  const createServerSession = useCallback(async () => {
    const s = usePlayerStore.getState().session;
    if (!s) return;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: s.storyId, currentNodeId: s.currentNodeId, history: s.history }),
      });
      if (res.ok) {
        const { id } = await res.json();
        if (id) usePlayerStore.getState().setSessionServerId(id);
      }
    } catch { /* offline — localStorage only */ }
  }, []);

  // Fill in deferred frame images. The branch pipeline / click-time only render the FIRST frame's
  // image; later frames come back with imagePrompt but no imageUrl. Generate them client-side.
  //
  // Self-healing: the dependency is a signature of which frames still need an image, so if a frame
  // is still pending (effect got cancelled mid-flight, a poll timed out, etc.) this RE-RUNS and
  // tries again instead of leaving a permanent black frame that never auto-updates. An in-flight
  // Set guards against submitting the same frame twice.
  const pendingFrameSig = (currentNode?.data.frames || [])
    .filter((f: any) => !f.imageUrl && !f.mediaUrl && f.imagePrompt)
    .map((f: any) => f.id)
    .join(',');
  const fillInFlightRef = useRef<Set<string>>(new Set());
  // Reset the in-flight guard whenever the node changes, so a revisited node can retry its fills.
  useEffect(() => { fillInFlightRef.current.clear(); }, [currentNode?.id]);
  useEffect(() => {
    const node = usePlayerStore.getState().currentNode;
    if (!node) return;
    const frames = node.data.frames || [];
    const pending = frames.filter(
      (f: any) => !f.imageUrl && !f.mediaUrl && f.imagePrompt && !fillInFlightRef.current.has(f.id),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      const st = usePlayerStore.getState();
      const ents = st.story?.entities || null;
      for (const frame of pending) {
        if (cancelled) return;
        fillInFlightRef.current.add(frame.id);
        try {
          const imageList = ents ? getEntityImageList(ents as any, (frame as any).entityRefs, node.data.character ?? null) : [];
          const subRes = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: (frame as any).imagePrompt,
              aspectRatio: '9:16',
              image_list: imageList.length > 0 ? imageList : undefined,
            }),
          });
          const sub = await subRes.json();
          if (!sub?.taskId) { fillInFlightRef.current.delete(frame.id); continue; }
          // Poll up to ~30s for this frame
          let done = false;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            if (cancelled) return; // keep it in-flight set? no — allow retry on next mount
            const pollRes = await fetch(`/api/generate-image?taskId=${encodeURIComponent(sub.taskId)}`);
            const pd = await pollRes.json();
            if (pd?.status === 'completed' && pd.imageUrl) {
              usePlayerStore.getState().updateFrameImage(node.id, (frame as any).id, pd.imageUrl);
              done = true;
              break;
            }
            if (pd?.status === 'failed' || pd?.status === 'moderated' || pd?.status === 'timeout') break;
          }
          // Release the guard. If it didn't succeed, the signature still lists this frame, so the
          // effect re-runs and retries (covers transient failures / cancellations).
          fillInFlightRef.current.delete(frame.id);
          void done;
        } catch {
          fillInFlightRef.current.delete(frame.id);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode?.id, pendingFrameSig]);

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

  // Transparent floating controls over full-bleed media — white icons with a soft drop-shadow
  // so they stay legible over bright frames.
  const frostedPill: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))',
  };
  const hasSpeaker = !!voiceSegments[currentSegmentIndex]?.speaker
    && voiceSegments[currentSegmentIndex].speaker !== 'narrator';

  return (
    <div
      className={`relative w-full overflow-hidden ${isPreview ? 'h-full' : 'h-[100dvh]'}`}
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* ===== Media layer — full-bleed background ===== */}
      <div className="absolute inset-0">
        {currentMediaType === 'video' && currentMediaUrl ? (
          <video
            ref={videoRef}
            key={currentMediaUrl}
            src={currentMediaUrl}
            className="w-full h-full object-cover"
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
          <img src={currentMediaUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          // No image (yet) — show a plain black backdrop. When a deferred frame's image is still
          // generating (currentFramePending) we deliberately show black rather than the previous
          // frame's stale image; no spinner or placeholder.
          <div className="w-full h-full" style={{ background: '#000' }}>
            {shownImage && !currentFramePending && (
              <img
                src={shownImage}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
        )}
      </div>

      {/* ===== Top controls ===== */}
      <div className="absolute top-0 inset-x-0 z-20">
        {/* Progress bar */}
        <div className="w-full h-1" style={{ background: 'rgba(20,20,19,0.08)' }}>
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%`, background: 'var(--accent)' }}
          />
        </div>

        {/* Floating control row */}
        <div className="flex items-center gap-2 px-3 py-3">
          {!isPreview && (
            <button
              onClick={() => { cancelAllGeneration(); router.push('/discover'); }}
              className="p-2 rounded-full transition-transform active:scale-95"
              style={{ ...frostedPill, color: '#fff' }}
              title="返回主页"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <span
            className="text-sm font-semibold flex-1 truncate px-1"
            style={{ color: '#ffffff', textShadow: '0 1px 4px rgba(0,0,0,0.6), 0 0 8px rgba(0,0,0,0.4)' }}
          >
            {story.title}
          </span>
          {!isPreview && (
            <button
              onClick={() => setShowProgress(true)}
              className="p-2 rounded-full transition-transform active:scale-95"
              style={{ ...frostedPill, color: '#fff' }}
              title="故事进度"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </button>
          )}
          {session && session.history.length > 0 && (
            <button
              onClick={() => { cancelAllGeneration(); goBack(); }}
              className="p-2 rounded-full transition-transform active:scale-95"
              style={{ ...frostedPill, color: '#fff' }}
              title="撤回上一步"
            >
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
            className="p-2 rounded-full transition-transform active:scale-95"
            style={{ ...frostedPill, color: '#fff' }}
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
      </div>

      {/* Narration Player (audio only, no visual footprint) */}
      <NarrationPlayer
        ref={narrationRef}
        nodeId={currentNode.id}
        voiceSegments={voiceSegments}
        onEnd={handleNarrationEnd}
        onSegmentChange={handleSegmentChange}
      />

      {/* ===== Bottom overlay: skip / subtitle / choices ===== */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 px-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 18px)' }}
      >
        {/* Skip button */}
        {!showChoices && currentNode && (
          <div className="flex justify-end pb-2">
            <button
              onClick={handleTap}
              className="px-2 py-1 text-[11px] transition-transform active:scale-95"
              style={{ color: '#ffffff', textShadow: '0 1px 4px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.45)' }}
            >
              跳过 ▶▶
            </button>
          </div>
        )}

        {/* Subtitle text.
            During playback (no choices yet): a reserved fixed-height slot so the text doesn't jump
            as segments swap (rem, not %: parent has no explicit height, so % would collapse to auto
            and let text grow bottom-up). Text fills top-down.
            Once choices are shown: switch to auto height (capped + scroll). This lets the narration
            hug its own content so the choices sit directly beneath it — a short narration no longer
            leaves a big empty gap between text and choices, and a long one scrolls within the cap. */}
        <div
          className="fade-in overflow-y-auto hide-scrollbar"
          key={`${currentNode.id}-${currentSegmentIndex}`}
          style={showChoices && !isEnding ? { maxHeight: '7.5rem' } : { height: '7.5rem' }}
        >
          {/* Speaker label for character segments */}
          {hasSpeaker && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded mb-2 inline-block"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {voiceSegments[currentSegmentIndex].speaker}
            </span>
          )}
          <p
            className={`text-[15px] leading-relaxed ${isTyping ? 'cursor-blink' : ''}`}
            style={{
              color: '#ffffff',
              textShadow: '0 1px 4px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.45)',
              fontStyle: hasSpeaker ? 'italic' : 'normal',
              borderLeft: hasSpeaker ? '2px solid var(--accent)' : 'none',
              paddingLeft: hasSpeaker ? 12 : 0,
            }}
          >
            {displayedText}
          </p>
        </div>

        {/* Ending */}
        {isEnding && showChoices && !isTyping && (() => {
          const meta = ENDING_META[currentNode.data.metadata?.endingType || 'normal'] || ENDING_META.normal;
          return (
            <div className="mt-5 text-center fade-in">
              {/* Ending rating tag (Best / Good / Normal / Bad / Hidden) */}
              <span
                className="inline-block text-[11px] font-bold tracking-wide px-2.5 py-0.5 rounded-full mb-2"
                style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}` }}
              >
                {meta.label} ENDING
              </span>
              <div className="text-lg font-bold mb-1" style={{ color: 'var(--node-ending)' }}>
                {currentNode.data.title}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>— 故事结束 —</p>
              <button
                onClick={() => { if (story) { usePlayerStore.getState().initSession(story); createServerSession(); } }}
                className="mt-4 px-6 py-2 rounded-lg text-sm"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                重新开始
              </button>
            </div>
          );
        })()}

        {/* Choices — only after the typewriter has fully revealed the text */}
        {showChoices && !isEnding && !isTyping && (
          <div
            className="mt-3 fade-in overflow-y-auto hide-scrollbar"
            style={{ maxHeight: '17rem' }}
          >
            {waitingForNode ? (
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: 'rgba(240,238,230,0.85)', border: '1px solid var(--border-strong)' }}
              >
                <ButterflyLoading prefix={waitingChoiceText} />
              </div>
            ) : waitFailed ? (
              <div
                className="rounded-xl px-4 py-3 text-center fade-in"
                style={{ background: 'rgba(240,238,230,0.92)', border: '1px solid var(--border-strong)' }}
              >
                <p className="text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>这一步生成失败了，请重试</p>
                <ChoicePanel
                  choices={(currentNode.data.choices || []).filter((c: any) => !c.visibility || c.visibility !== 'hidden')}
                  onChoose={(id) => { setWaitFailed(false); handleChoose(id); }}
                  showHiddenBadge={false}
                />
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
              </>
            )}
          </div>
        )}
        {/* CustomInput is rendered for EVERY node (not just when choices show) so its background
            prefetch fires on node ENTRY — overlapping generation with the narration the player is
            reading, instead of only starting after choices appear. The input box itself shows only
            when it's actually the player's turn to type. */}
        {!isPreview && currentNode && (
          <CustomInput
            nodeId={currentNode.id}
            storyId={story.id}
            canInput={showChoices && !isEnding && !isTyping && !waitingForNode && !waitFailed && !!currentNode.data.allowCustomInput}
          />
        )}
      </div>

      {/* Story progress panel */}
      {showProgress && <StoryProgressPanel onClose={() => setShowProgress(false)} />}
    </div>
  );
}
