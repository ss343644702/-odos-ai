'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { buildStoryline } from '@/types/story';
import { v4 as uuid } from 'uuid';
import ButterflyLoading from './ButterflyLoading';

interface CustomInputProps {
  nodeId: string;
  storyId: string;
  // When false, the free-input box is hidden but the background prefetch still runs. This lets
  // nodes that don't allow custom input (e.g. converge bridges) still pre-generate their children,
  // so clicking 继续 doesn't fall into the slow on-demand path.
  canInput?: boolean;
}

/** Check if a node needs prefetch: no narration or no voice segments */
function needsPrefetch(node: any): boolean {
  const hasNarration = !!node?.data?.narration;
  const hasVoice = (node?.data?.voiceSegments?.length ?? 0) > 0;
  return !hasNarration || !hasVoice;
}

/** Check if a node is fully ready for playback (has narration AND voice) */
function isNodeReady(node: any): boolean {
  return !!node?.data?.narration && (node?.data?.voiceSegments?.length ?? 0) > 0;
}

const MAX_RETRIES = 2;

export default function CustomInput({ nodeId, storyId, canInput = true }: CustomInputProps) {
  const [input, setInput] = useState('');
  const [rejectMessage, setRejectMessage] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const submitCustomInput = usePlayerStore((s) => s.submitCustomInput);
  const setBranching = usePlayerStore((s) => s.setBranching);
  const setCurrentNode = usePlayerStore((s) => s.setCurrentNode);
  const navigateToNode = usePlayerStore((s) => s.navigateToNode);
  const addGeneratedNodes = usePlayerStore((s) => s.addGeneratedNodes);
  const updateGeneratedNode = usePlayerStore((s) => s.updateGeneratedNode);
  const addGeneratedBranch = usePlayerStore((s) => s.addGeneratedBranch);
  const findMatchingBranch = usePlayerStore((s) => s.findMatchingBranch);
  const story = usePlayerStore((s) => s.story);
  const session = usePlayerStore((s) => s.session);
  const isBranching = usePlayerStore((s) => s.isBranching);
  // Prefetch can run from two triggers (node-entry effect + post-pipeline). Track every in-flight
  // controller (so we can abort them all on leave/submit) and the set of node ids currently being
  // generated (so overlapping triggers don't re-issue — and abort — each other's work).
  const prefetchControllersRef = useRef<Set<AbortController>>(new Set());
  const prefetchInFlightRef = useRef<Set<string>>(new Set());
  const pipelineAbortRef = useRef<AbortController | null>(null);

  const abortAllPrefetch = useCallback(() => {
    prefetchControllersRef.current.forEach((c) => c.abort());
    prefetchControllersRef.current.clear();
    prefetchInFlightRef.current.clear();
  }, []);

  // Abort any in-flight generation when leaving this node / unmounting (e.g. player hits back)
  useEffect(() => {
    return () => {
      pipelineAbortRef.current?.abort();
      abortAllPrefetch();
    };
  }, [nodeId, abortAllPrefetch]);

  /** Background prefetch: generate narration + voice + TTS for stub nodes */
  const runPrefetch = useCallback(async (
    nodesToPrefetch: any[],
    branchDepth: number,
    convergenceTarget: string,
  ) => {
    if (nodesToPrefetch.length === 0) return;

    // Deduplicate: skip nodes that already have full content OR are already being prefetched by
    // another in-flight call. Without the in-flight check, the node-entry and post-pipeline
    // triggers fire for the same stubs and abort each other mid-request (truncated body → server
    // errors + wasted work).
    const existing = usePlayerStore.getState().story?.nodes || [];
    const toProcess = nodesToPrefetch.filter((n: any) => {
      if (prefetchInFlightRef.current.has(n.id)) return false;
      const existingNode = existing.find((en) => en.id === n.id);
      return !existingNode || needsPrefetch(existingNode);
    });
    if (toProcess.length === 0) return;

    // Each prefetch gets its OWN controller (no longer aborts sibling prefetches) and registers
    // its node ids so overlapping triggers skip them above.
    const abortController = new AbortController();
    prefetchControllersRef.current.add(abortController);
    const inFlightIds: string[] = toProcess.map((n: any) => n.id);
    inFlightIds.forEach((id) => prefetchInFlightRef.current.add(id));

    const buildBody = () => ({
      storyId,
      nodes: toProcess,
      // Linear story-so-far (start → current node) from history only — excludes abandoned branches.
      storyline: buildStoryline(
        usePlayerStore.getState().story?.nodes || [],
        usePlayerStore.getState().session?.history || [],
        nodeId,
      ),
      worldView: story?.worldView || '',
      playerObjective: story?.playerObjective || null,
      mainPlotNodeIds: story?.nodes?.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => n.id) || [],
      mainPlotNodes: story?.nodes?.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => ({
        id: n.id, type: n.type, title: n.data.title, narration: n.data.narration,
        choices: n.data.choices?.map((c) => ({ id: c.id, text: c.text, targetNodeId: c.targetNodeId })),
      })) || [],
      style: story?.style || null,
      entities: story?.entities || null,
      defaultVoice: story?.settings?.defaultVoice || 'narrator',
      branchDepth,
      convergenceTarget,
      convergenceTargetContext: (() => {
        const ctNode = story?.nodes?.find((n) => n.id === convergenceTarget);
        return ctNode ? { title: ctNode.data.title, narration: ctNode.data.narration } : null;
      })(),
    });

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (abortController.signal.aborted) return;
        try {
          const res = await fetch('/api/branch-prefetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody()),
            signal: abortController.signal,
          });
          if (!res.ok) {
            if (attempt < MAX_RETRIES) continue;
            return;
          }
          const data = await res.json();

          if (abortController.signal.aborted) return;

          for (const completed of (data.completedNodes || [])) {
            updateGeneratedNode(completed.nodeId, completed.data);
          }

          const newExtras = data.newExtraNodes || [];
          if (newExtras.length > 0) {
            const currentNodes = usePlayerStore.getState().story?.nodes || [];
            const fresh = newExtras.filter((n: any) => !currentNodes.some((en) => en.id === n.id));
            if (fresh.length > 0) addGeneratedNodes(fresh);
            // Only prefetch 1 level deep (immediate next choices), not recursive
            const incomplete = fresh.filter((n: any) => needsPrefetch(n));
            if (incomplete.length > 0 && branchDepth < 1) {
              runPrefetch(incomplete, branchDepth + 1, convergenceTarget);
            }
          }
          return; // Success
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          if (attempt >= MAX_RETRIES) return;
        }
      }
    } finally {
      prefetchControllersRef.current.delete(abortController);
      inFlightIds.forEach((id) => prefetchInFlightRef.current.delete(id));
    }
  }, [storyId, story, updateGeneratedNode, addGeneratedNodes]);

  // Auto-prefetch: when entering a new node, check if its children need prefetch
  // Only depend on nodeId to avoid re-triggering when story.nodes updates from prefetch results
  const prefetchTriggeredRef = useRef<string>('');
  useEffect(() => {
    // Skip if we already triggered prefetch for this node
    if (prefetchTriggeredRef.current === nodeId) return;

    const currentStory = usePlayerStore.getState().story;
    const allNodes = currentStory?.nodes || [];
    const currentNode = allNodes.find((n) => n.id === nodeId);
    if (!currentNode) return;

    const choices = currentNode.data.choices || [];
    if (choices.length === 0) return;

    const childStubs = choices
      .map((c: any) => allNodes.find((n) => n.id === c.targetNodeId))
      .filter((n: any) => n && needsPrefetch(n));

    if (childStubs.length === 0) return;

    // Mark as triggered for this node
    prefetchTriggeredRef.current = nodeId;

    const meta = currentNode.data.metadata || {};
    const ct = meta.convergenceTarget ||
      allNodes.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => n.id)[0] || '';

    runPrefetch(childStubs, 1, ct);
  }, [nodeId, runPrefetch]);

  /** Call pipeline with retry */
  const callPipeline = useCallback(async (text: string, signal?: AbortSignal) => {
    const buildBody = () => {
      const allNodes = story?.nodes || [];
      const mainNodes = allNodes.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config');

      // Build rich main plot nodes with choice text + connection info
      const mainPlotNodes = mainNodes.map((n) => ({
        id: n.id, type: n.type, title: n.data.title,
        narration: n.data.narration,
        choices: n.data.choices?.map((c) => ({
          id: c.id,
          text: c.text,
          targetNodeId: c.targetNodeId,
        })),
      }));

      // Build recent AI narration chain: narration from AI-generated nodes in history
      const hist = session?.history || [];
      const recentAiNarrations = hist
        .slice(-20)
        .map((step) => {
          const node = allNodes.find((n) => n.id === step.nodeId);
          if (!node) return null;
          return {
            nodeId: node.id,
            title: node.data.title,
            narration: node.data.narration,
            wasCustomInput: !!step.customInput,
            customInput: step.customInput || undefined,
            isAiGenerated: node.type === 'ai_generated',
          };
        })
        .filter(Boolean);

      // Collect ending nodes for route_to_ending
      const endingNodes = allNodes
        .filter((n) => n.type === 'ending')
        .map((n) => ({ id: n.id, title: n.data.title, narration: n.data.narration }));

      // Intent constraint: when enabled, restrict navigate_existing matching to the allowed
      // choices only (Fix B), and send their texts for the reject gate.
      const curNode = allNodes.find((n) => n.id === nodeId);
      const allowedChoiceIds = (curNode?.data.constrainIntents && curNode.data.constrainIntentChoiceIds?.length)
        ? new Set(curNode.data.constrainIntentChoiceIds)
        : null;
      const allChoices = curNode?.data.choices || [];
      const visibleChoices = allowedChoiceIds ? allChoices.filter((c: any) => allowedChoiceIds.has(c.id)) : allChoices;

      return {
        storyId,
        currentNodeId: nodeId,
        playerInput: text,
        history: hist,
        recentAiNarrations,
        // Linear story-so-far (start → current node), built strictly from history so it excludes
        // abandoned branch attempts (goBack pops them). Lets the LLM reason with the real plot line.
        storyline: buildStoryline(allNodes, hist, nodeId),
        worldView: story?.worldView || '',
        playerObjective: story?.playerObjective || null,
        mainPlotNodeIds: mainNodes.map((n) => n.id),
        mainPlotNodes,
        endingNodes,
        existingChoices: visibleChoices,
        currentNodeContext: (() => {
          const node = allNodes.find((n) => n.id === nodeId);
          return node ? { title: node.data.title, narration: node.data.narration, dialogue: node.data.dialogue, character: node.data.character } : null;
        })(),
        // Allowed choice texts for the reject gate (null = unconstrained)
        constrainIntents: allowedChoiceIds ? visibleChoices.map((c: any) => c.text) : null,
        style: story?.style || null,
        entities: story?.entities || null,
        defaultVoice: story?.settings?.defaultVoice || 'narrator',
      };
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch('/api/branch-pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
          signal,
        });
        const result = await response.json();
        if (response.ok && result.action) return result;
        // Retry on server error
        if (attempt < MAX_RETRIES) continue;
        return null;
      } catch (err: any) {
        if (err?.name === 'AbortError') return null; // user cancelled — stop, no retry
        if (attempt >= MAX_RETRIES) return null;
      }
    }
    return null;
  }, [storyId, nodeId, story, session]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isBranching) return;

    setInput('');
    setSubmittedText(text);
    // Cancel any in-flight prefetch before starting new pipeline
    abortAllPrefetch();
    // Show loading IMMEDIATELY (history is recorded only on success — see below)
    setBranching(true);

    // Intent-constrained nodes must route deterministically via the decision (navigate_existing),
    // NOT via the fuzzy/semantic branch cache — a fuzzy cache hit can jump to the wrong node. (Fix A)
    const curNode = (story?.nodes || []).find((n) => n.id === nodeId);
    const intentConstrained = !!(curNode?.data.constrainIntents && curNode.data.constrainIntentChoiceIds?.length);

    // Check local cache (skipped for intent-constrained nodes)
    const cached = intentConstrained ? null : findMatchingBranch(nodeId, text);
    if (cached) {
      const existingNodes = story?.nodes || [];
      const newNodes = cached.generatedNodes.filter(
        (n) => !existingNodes.some((en) => en.id === n.id)
      );
      if (newNodes.length > 0) addGeneratedNodes(newNodes);
      // Prefer the fresh node from the store (cached copy may be stale after prefetch)
      const headId = cached.generatedNodes[0]?.id;
      const fresh = usePlayerStore.getState().story?.nodes?.find((n) => n.id === headId);
      submitCustomInput(text);
      setCurrentNode(fresh || cached.generatedNodes[0]);
      setBranching(false);
      return;
    }

    // Check server cache (skipped for intent-constrained nodes)
    if (!intentConstrained) try {
      const cacheRes = await fetch(`/api/branches?storyId=${encodeURIComponent(storyId)}&parentNodeId=${encodeURIComponent(nodeId)}&input=${encodeURIComponent(text)}`);
      const cacheData = await cacheRes.json();
      if (cacheData.branch) {
        const serverNodes = (cacheData.branch.generatedNodes || []) as NonNullable<typeof story>['nodes'];
        const existingNodes = story?.nodes || [];
        const newNodes = serverNodes.filter(
          (n: any) => !existingNodes.some((en) => en.id === n.id)
        );
        if (newNodes.length > 0) addGeneratedNodes(newNodes);
        addGeneratedBranch({
          id: cacheData.branch.id, storyId, parentNodeId: nodeId, playerInput: text,
          generatedNodes: serverNodes, generatedEdges: cacheData.branch.generatedEdges || [],
          usageCount: cacheData.branch.usageCount || 1, createdAt: cacheData.branch.createdAt,
        });
        if (serverNodes.length > 0) {
          submitCustomInput(text);
          setCurrentNode(serverNodes[0]);
        }
        setBranching(false);
        return;
      }
    } catch { /* continue */ }

    // Full pipeline with retry (abortable)
    const controller = new AbortController();
    pipelineAbortRef.current = controller;
    const result = await callPipeline(text, controller.signal);
    pipelineAbortRef.current = null;

    // User cancelled mid-flight — UI already reset by the cancel handler
    if (controller.signal.aborted) return;

    if (!result) {
      setBranching(false);
      setInput(text); // restore so the player doesn't lose what they typed
      setRejectMessage('生成失败，请重试');
      setTimeout(() => setRejectMessage(''), 5000);
      return;
    }

    if (result.action === 'reject') {
      setBranching(false);
      setInput(text); // restore the rejected input for editing
      setRejectMessage(result.message || '大白天想什么呢，重新选择一下吧');
      setTimeout(() => setRejectMessage(''), 5000);
      return;
    }

    if (result.action === 'navigate_existing' && result.targetNodeId) {
      // Check if player triggered a hidden/best choice
      const allNodes = usePlayerStore.getState().story?.nodes || [];
      const currentNodeData = allNodes.find((n) => n.id === nodeId);
      const matchedChoice = currentNodeData?.data.choices?.find((c: any) => c.targetNodeId === result.targetNodeId);
      const isHidden = matchedChoice?.visibility === 'hidden';

      // navigateToNode records exactly one history step (do NOT also call submitCustomInput)
      navigateToNode(result.targetNodeId, text);

      // Cache the input→existing-node mapping so identical input skips the decision LLM next time
      const targetNode = allNodes.find((n) => n.id === result.targetNodeId);
      if (targetNode) {
        addGeneratedBranch({
          id: uuid(), storyId, parentNodeId: nodeId, playerInput: text,
          generatedNodes: [targetNode], generatedEdges: [],
          usageCount: 1, createdAt: new Date().toISOString(),
        });
      }

      // Record hidden trigger for future achievement system
      if (isHidden) {
        const sess = usePlayerStore.getState().session;
        if (sess && sess.history.length > 0) {
          const lastStep = sess.history[sess.history.length - 1] as any;
          lastStep.triggeredHidden = true;
          lastStep.hiddenChoiceText = matchedChoice?.text || '';
        }
      }

      setBranching(false);
      return;
    }

    if ((result.action === 'converge_to_main' || result.action === 'route_to_ending') && result.newNodes) {
      const mainNode = result.newNodes[0];

      // Verify main node is fully ready (has narration + voice)
      if (!isNodeReady(mainNode)) {
        // Main node incomplete — should not happen, but handle gracefully
        setBranching(false);
        setInput(text);
        setRejectMessage('生成失败，请重试');
        setTimeout(() => setRejectMessage(''), 5000);
        return;
      }

      addGeneratedNodes(result.newNodes);
      submitCustomInput(text); // record history before switching node (reads currentNode)
      setCurrentNode(mainNode);

      // Cache
      const branchId = uuid();
      addGeneratedBranch({
        id: branchId, storyId, parentNodeId: nodeId, playerInput: text,
        generatedNodes: result.newNodes, generatedEdges: [],
        usageCount: 1, createdAt: new Date().toISOString(),
      });
      fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, parentNodeId: nodeId, playerInput: text, generatedNodes: result.newNodes, generatedEdges: [] }),
      }).catch(() => {});

      // Persist all dynamic nodes to session DB for cross-device recovery
      if (session?.id) {
        const allDynamic = usePlayerStore.getState().generatedBranches;
        const allDynamicNodes = allDynamic.flatMap((b: any) => b.generatedNodes || []);
        const allDynamicEdges = allDynamic.flatMap((b: any) => b.generatedEdges || []);
        fetch(`/api/sessions/${session.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dynamicNodes: allDynamicNodes, dynamicEdges: allDynamicEdges }),
        }).catch(() => {});
      }

      // Fire prefetch for ALL extra nodes needing content during playback
      const incompleteNodes = result.newNodes.slice(1).filter(
        (n: any) => needsPrefetch(n)
      );
      if (incompleteNodes.length > 0) {
        const ct = result.convergenceTarget ||
          (story?.nodes?.filter((n) => n.type !== 'ai_generated' && n.type !== 'story_config').map((n) => n.id) || [])[0];
        runPrefetch(incompleteNodes, 1, ct);
      }

      setBranching(false);
      return;
    }

    setBranching(false);
  }, [input, isBranching, nodeId, storyId, story, session, submitCustomInput, setBranching, setCurrentNode, addGeneratedNodes, addGeneratedBranch, findMatchingBranch, runPrefetch, callPipeline]);

  /** Cancel an in-flight generation and restore the typed text */
  const handleCancel = useCallback(() => {
    pipelineAbortRef.current?.abort();
    pipelineAbortRef.current = null;
    abortAllPrefetch();
    setBranching(false);
    if (submittedText) setInput(submittedText);
  }, [setBranching, submittedText]);

  // Input box is hidden when custom input isn't allowed — but all hooks above (incl. the prefetch
  // effect) have already run, so this node's children still get pre-generated.
  if (!canInput) return null;

  return (
    <div className="mt-3">
      <div
        className="flex items-center gap-2 rounded-xl overflow-hidden"
        style={{ border: '1px dashed var(--accent)', background: 'var(--bg-tertiary)' }}
      >
        {isBranching ? (
          <>
            <div className="flex-1 min-w-0">
              <ButterflyLoading prefix={submittedText} />
            </div>
            <button
              onClick={handleCancel}
              className="px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="取消生成"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="flex-1 px-4 py-3 text-sm bg-transparent outline-none"
              style={{ color: 'var(--text-primary)' }}
              placeholder="输入你的选择..."
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="px-4 py-3 text-sm font-medium transition-colors disabled:opacity-30"
              style={{ color: 'var(--accent)' }}
            >
              发送
            </button>
          </>
        )}
      </div>
      {!isBranching && (
        <p className="text-[10px] mt-1 text-center" style={{ color: rejectMessage ? 'var(--danger)' : 'var(--text-muted)' }}>
          {rejectMessage || '自由输入你想做的选择，AI 会为你推理剧情走向'}
        </p>
      )}
    </div>
  );
}
