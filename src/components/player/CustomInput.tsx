'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { v4 as uuid } from 'uuid';
import ButterflyLoading from './ButterflyLoading';

interface CustomInputProps {
  nodeId: string;
  storyId: string;
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

export default function CustomInput({ nodeId, storyId }: CustomInputProps) {
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
  const prefetchAbortRef = useRef<AbortController | null>(null);

  /** Background prefetch: generate narration + voice + TTS for stub nodes */
  const runPrefetch = useCallback(async (
    nodesToPrefetch: any[],
    branchDepth: number,
    convergenceTarget: string,
  ) => {
    if (nodesToPrefetch.length === 0) return;

    // Deduplicate: skip nodes that already have full content
    const existing = usePlayerStore.getState().story?.nodes || [];
    const toProcess = nodesToPrefetch.filter((n: any) => {
      const existingNode = existing.find((en) => en.id === n.id);
      return !existingNode || needsPrefetch(existingNode);
    });
    if (toProcess.length === 0) return;

    // Cancel any previous in-flight prefetch
    prefetchAbortRef.current?.abort();
    const abortController = new AbortController();
    prefetchAbortRef.current = abortController;

    const buildBody = () => ({
      storyId,
      nodes: toProcess,
      worldView: story?.worldView || '',
      playerObjective: story?.playerObjective || null,
      mainPlotNodeIds: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => n.id) || [],
      mainPlotNodes: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => ({
        id: n.id, type: n.type, title: n.data.title, narration: n.data.narration?.slice(0, 200),
        choices: n.data.choices?.map((c) => ({ id: c.id, text: c.text, targetNodeId: c.targetNodeId })),
      })) || [],
      style: story?.style || null,
      entities: story?.entities || null,
      defaultVoice: story?.settings?.defaultVoice || 'narrator',
      branchDepth,
      convergenceTarget,
      convergenceTargetContext: (() => {
        const ctNode = story?.nodes?.find((n) => n.id === convergenceTarget);
        return ctNode ? { title: ctNode.data.title, narration: ctNode.data.narration?.slice(0, 150) } : null;
      })(),
    });

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
      allNodes.filter((n) => n.type !== 'ai_generated').map((n) => n.id)[0] || '';

    runPrefetch(childStubs, 1, ct);
  }, [nodeId, runPrefetch]);

  /** Call pipeline with retry */
  const callPipeline = useCallback(async (text: string) => {
    const buildBody = () => {
      const allNodes = story?.nodes || [];
      const mainNodes = allNodes.filter((n) => n.type !== 'ai_generated');

      // Build rich main plot nodes with choice text + connection info
      const mainPlotNodes = mainNodes.map((n) => ({
        id: n.id, type: n.type, title: n.data.title,
        narration: n.data.narration?.slice(0, 150),
        choices: n.data.choices?.map((c) => ({
          id: c.id,
          text: c.text,
          targetNodeId: c.targetNodeId,
        })),
      }));

      // Build recent AI narration chain: narration from AI-generated nodes in history
      const hist = session?.history || [];
      const recentAiNarrations = hist
        .slice(-6)
        .map((step) => {
          const node = allNodes.find((n) => n.id === step.nodeId);
          if (!node) return null;
          return {
            nodeId: node.id,
            title: node.data.title,
            narration: node.data.narration?.slice(0, 150),
            wasCustomInput: !!step.customInput,
            customInput: step.customInput || undefined,
            isAiGenerated: node.type === 'ai_generated',
          };
        })
        .filter(Boolean);

      // Collect ending nodes for route_to_ending
      const endingNodes = allNodes
        .filter((n) => n.type === 'ending')
        .map((n) => ({ id: n.id, title: n.data.title, narration: n.data.narration?.slice(0, 200) }));

      return {
        storyId,
        currentNodeId: nodeId,
        playerInput: text,
        history: hist,
        recentAiNarrations,
        worldView: story?.worldView || '',
        playerObjective: story?.playerObjective || null,
        mainPlotNodeIds: mainNodes.map((n) => n.id),
        mainPlotNodes,
        endingNodes,
        existingChoices: allNodes.find((n) => n.id === nodeId)?.data.choices || [],
        currentNodeContext: (() => {
          const node = allNodes.find((n) => n.id === nodeId);
          return node ? { title: node.data.title, narration: node.data.narration, dialogue: node.data.dialogue, character: node.data.character } : null;
        })(),
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
        });
        const result = await response.json();
        if (response.ok && result.action) return result;
        // Retry on server error
        if (attempt < MAX_RETRIES) continue;
        return null;
      } catch {
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
    prefetchAbortRef.current?.abort();
    // Show loading IMMEDIATELY
    setBranching(true);
    submitCustomInput(text);

    // Check local cache
    const cached = findMatchingBranch(nodeId, text);
    if (cached) {
      const existingNodes = story?.nodes || [];
      const newNodes = cached.generatedNodes.filter(
        (n) => !existingNodes.some((en) => en.id === n.id)
      );
      if (newNodes.length > 0) addGeneratedNodes(newNodes);
      setCurrentNode(cached.generatedNodes[0]);
      setBranching(false);
      return;
    }

    // Check server cache
    try {
      const cacheRes = await fetch(`/api/branches?storyId=${encodeURIComponent(storyId)}&parentNodeId=${encodeURIComponent(nodeId)}&input=${encodeURIComponent(text)}`);
      const cacheData = await cacheRes.json();
      if (cacheData.branch) {
        const serverNodes = (cacheData.branch.generatedNodes || []) as NonNullable<typeof story>['nodes'];
        const existingNodes = story?.nodes || [];
        const newNodes = serverNodes.filter(
          (n: any) => !existingNodes.some((en) => en.id === n.id)
        );
        if (newNodes.length > 0) addGeneratedNodes(newNodes);
        if (serverNodes.length > 0) setCurrentNode(serverNodes[0]);
        addGeneratedBranch({
          id: cacheData.branch.id, storyId, parentNodeId: nodeId, playerInput: text,
          generatedNodes: serverNodes, generatedEdges: cacheData.branch.generatedEdges || [],
          usageCount: cacheData.branch.usageCount || 1, createdAt: cacheData.branch.createdAt,
        });
        setBranching(false);
        return;
      }
    } catch { /* continue */ }

    // Full pipeline with retry
    const result = await callPipeline(text);

    if (!result) {
      setBranching(false);
      setRejectMessage('生成失败，请重试');
      setTimeout(() => setRejectMessage(''), 5000);
      return;
    }

    if (result.action === 'reject') {
      setBranching(false);
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

      navigateToNode(result.targetNodeId, text);

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
        alert('生成失败，请重试');
        return;
      }

      addGeneratedNodes(result.newNodes);
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

      // Fire prefetch for ALL extra nodes needing content during playback
      const incompleteNodes = result.newNodes.slice(1).filter(
        (n: any) => needsPrefetch(n)
      );
      if (incompleteNodes.length > 0) {
        const ct = result.convergenceTarget ||
          (story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => n.id) || [])[0];
        runPrefetch(incompleteNodes, 1, ct);
      }

      setBranching(false);
      return;
    }

    setBranching(false);
  }, [input, isBranching, nodeId, storyId, story, session, submitCustomInput, setBranching, setCurrentNode, addGeneratedNodes, addGeneratedBranch, findMatchingBranch, runPrefetch, callPipeline]);

  return (
    <div className="mt-3">
      <div
        className="flex items-center gap-2 rounded-xl overflow-hidden"
        style={{ border: '1px dashed var(--accent)', background: 'var(--bg-tertiary)' }}
      >
        {isBranching ? (
          <ButterflyLoading prefix={submittedText} />
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
