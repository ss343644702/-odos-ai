/**
 * Build a StoryContextSnapshot from client-side Zustand stores.
 * Used by useAgentGraph before invoking the server graph.
 */
'use client';

import { useStoryStore } from '@/stores/storyStore';
import { useChatStore } from '@/stores/chatStore';
import type { StoryContextSnapshot } from './state';

export function buildStoryContext(includeFullData = false): StoryContextSnapshot {
  const story = useStoryStore.getState().story;
  const orchestrator = useChatStore.getState().orchestrator;

  const storyNodes = story?.nodes?.filter(n => n.type !== 'story_config') || [];
  const storyEdges = story?.edges || [];

  const nodes = storyNodes.map(n => ({
    id: n.id,
    type: n.type,
    title: n.data.title,
    depth: n.data.depth,
    choiceCount: n.data.choices?.length || 0,
    frameCount: n.data.frames?.length || 0,
    hasVoice: (n.data.voiceSegments?.length || 0) > 0,
  }));

  const edges = storyEdges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.label,
  }));

  const endingCount = storyNodes.filter(n => n.type === 'ending').length;
  const nodesWithFrames = storyNodes.filter(n => (n.data.frames?.length || 0) > 0).length;
  const nodesWithVoice = storyNodes.filter(n => (n.data.voiceSegments?.length || 0) > 0).length;

  return {
    storyDescription: orchestrator.storyDescription || story?.description || '',
    style: orchestrator.style || story?.style || null,
    outline: orchestrator.outline || null,
    entities: orchestrator.entities || null,
    nodes,
    edges,
    nodeCount: storyNodes.length,
    endingCount,
    nodesWithFrames,
    nodesWithVoice,
    ...(includeFullData ? { fullNodes: storyNodes, fullEdges: storyEdges } : {}),
  };
}
