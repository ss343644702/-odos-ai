'use client';

import { useState, useCallback } from 'react';
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
  const submitCustomInput = usePlayerStore((s) => s.submitCustomInput);
  const setBranching = usePlayerStore((s) => s.setBranching);
  const setCurrentNode = usePlayerStore((s) => s.setCurrentNode);
  const addGeneratedNodes = usePlayerStore((s) => s.addGeneratedNodes);
  const updateGeneratedNode = usePlayerStore((s) => s.updateGeneratedNode);
  const addGeneratedBranch = usePlayerStore((s) => s.addGeneratedBranch);
  const findMatchingBranch = usePlayerStore((s) => s.findMatchingBranch);
  const story = usePlayerStore((s) => s.story);
  const session = usePlayerStore((s) => s.session);
  const isBranching = usePlayerStore((s) => s.isBranching);

  /** Background prefetch: generate narration + voice + TTS for stub nodes */
  const runPrefetch = useCallback(async (
    nodesToPrefetch: any[],
    branchDepth: number,
    convergenceTarget: string,
  ) => {
    if (nodesToPrefetch.length === 0) return;

    const buildBody = () => ({
      storyId,
      nodes: nodesToPrefetch,
      worldView: story?.worldView || '',
      mainPlotNodeIds: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => n.id) || [],
      mainPlotNodes: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => ({
        id: n.id, type: n.type, title: n.data.title, narration: n.data.narration?.slice(0, 100),
      })) || [],
      style: story?.style || null,
      entities: null,
      defaultVoice: story?.settings?.defaultVoice || 'narrator',
      branchDepth,
      convergenceTarget,
      convergenceTargetContext: (() => {
        const ctNode = story?.nodes?.find((n) => n.id === convergenceTarget);
        return ctNode ? { title: ctNode.data.title, narration: ctNode.data.narration?.slice(0, 150) } : null;
      })(),
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/branch-prefetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody()),
        });
        if (!res.ok) {
          if (attempt < MAX_RETRIES) continue;
          return;
        }
        const data = await res.json();

        for (const completed of (data.completedNodes || [])) {
          updateGeneratedNode(completed.nodeId, completed.data);
        }

        const newExtras = data.newExtraNodes || [];
        if (newExtras.length > 0) {
          const existing = usePlayerStore.getState().story?.nodes || [];
          const fresh = newExtras.filter((n: any) => !existing.some((en) => en.id === n.id));
          if (fresh.length > 0) addGeneratedNodes(fresh);
          const incomplete = fresh.filter((n: any) => needsPrefetch(n));
          if (incomplete.length > 0 && branchDepth < 5) {
            runPrefetch(incomplete, branchDepth + 1, convergenceTarget);
          }
        }
        return; // Success
      } catch {
        if (attempt >= MAX_RETRIES) return;
      }
    }
  }, [storyId, story, updateGeneratedNode, addGeneratedNodes]);

  /** Call pipeline with retry */
  const callPipeline = useCallback(async (text: string) => {
    const buildBody = () => ({
      storyId,
      currentNodeId: nodeId,
      playerInput: text,
      history: session?.history || [],
      worldView: story?.worldView || '',
      mainPlotNodeIds: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => n.id) || [],
      mainPlotNodes: story?.nodes?.filter((n) => n.type !== 'ai_generated').map((n) => ({
        id: n.id, type: n.type, title: n.data.title, narration: n.data.narration?.slice(0, 100),
        choices: n.data.choices?.map((c) => ({ targetNodeId: c.targetNodeId })),
      })) || [],
      existingChoices: story?.nodes?.find((n) => n.id === nodeId)?.data.choices || [],
      currentNodeContext: (() => {
        const node = story?.nodes?.find((n) => n.id === nodeId);
        return node ? { title: node.data.title, narration: node.data.narration, dialogue: node.data.dialogue, character: node.data.character } : null;
      })(),
      style: story?.style || null,
      entities: null,
      defaultVoice: story?.settings?.defaultVoice || 'narrator',
    });

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
      alert('生成失败，请重试');
      return;
    }

    if (result.action === 'reject') {
      setBranching(false);
      alert(result.message || '在想什么呢，重新做一个选择吧');
      return;
    }

    if (result.action === 'navigate_existing' && result.targetNodeId) {
      const targetNode = story?.nodes?.find((n) => n.id === result.targetNodeId);
      if (targetNode) setCurrentNode(targetNode);
      setBranching(false);
      return;
    }

    if ((result.action === 'converge_to_main' || result.action === 'new_ending') && result.newNodes) {
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
          <ButterflyLoading />
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
        <p className="text-[10px] mt-1 text-center" style={{ color: 'var(--text-muted)' }}>
          自由输入你想做的选择，AI 会为你推理剧情走向
        </p>
      )}
    </div>
  );
}
