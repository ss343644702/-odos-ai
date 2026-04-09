'use client';

import { useCallback, useMemo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  type NodeTypes,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import StoryNodeComponent from './StoryNode';
import { useStoryStore } from '@/stores/storyStore';
import { useEditorStore } from '@/stores/editorStore';
import { v4 as uuid } from 'uuid';
import type { StoryNode, StoryEdge } from '@/types/story';

const nodeTypes: NodeTypes = {
  storyNode: StoryNodeComponent as any,
};

function storyNodeToFlow(node: StoryNode): Node {
  return {
    id: node.id,
    type: 'storyNode',
    position: node.position,
    data: { ...node.data, nodeType: node.type },
    selected: false,
  };
}

function storyEdgeToFlow(edge: StoryEdge, storyNodes?: StoryNode[]): Edge {
  // Resolve sourceHandle and label from source node's choices
  let resolvedHandle: string | undefined = undefined;
  let resolvedLabel: string = edge.label || '';

  const needsResolve = !edge.sourceHandle || edge.sourceHandle === 'default';
  if (needsResolve && storyNodes) {
    const sourceNode = storyNodes.find((n) => n.id === edge.source);
    const choices = sourceNode?.data.choices || [];
    if (choices.length > 0) {
      // Match by targetNodeId first, then by label text, fallback to first choice
      const matchByTarget = choices.find((c) => c.targetNodeId === edge.target);
      const matchByLabel = edge.label ? choices.find((c) => c.text === edge.label) : null;
      const matched = matchByTarget || matchByLabel || choices[0];
      resolvedHandle = matched.id;
      if (!resolvedLabel) resolvedLabel = matched.text || '';
    }
  } else if (edge.sourceHandle && edge.sourceHandle !== 'default') {
    resolvedHandle = edge.sourceHandle;
    // Always resolve label from current choice text (keeps edge label in sync with choice edits)
    if (storyNodes) {
      const sourceNode = storyNodes.find((n) => n.id === edge.source);
      const choice = sourceNode?.data.choices?.find((c) => c.id === edge.sourceHandle);
      if (choice) resolvedLabel = choice.text || '';
    }
  }

  // Check if this edge connects from a hidden/best choice
  let isHiddenChoice = false;
  if (storyNodes && resolvedHandle) {
    const srcNode = storyNodes.find((n) => n.id === edge.source);
    const srcChoice = srcNode?.data.choices?.find((c) => c.id === resolvedHandle);
    isHiddenChoice = srcChoice?.visibility === 'hidden';
  }

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: resolvedHandle,
    targetHandle: undefined,
    label: resolvedLabel.length > 15 ? resolvedLabel.slice(0, 15) + '…' : resolvedLabel,
    type: 'smoothstep',
    animated: isHiddenChoice || edge.type === 'ai_generated',
    style: {
      stroke: isHiddenChoice ? 'var(--accent)' : edge.type === 'ai_generated' ? 'var(--node-ai)' : 'var(--text-muted)',
      strokeWidth: 2,
      ...(isHiddenChoice ? { strokeDasharray: '6 3' } : {}),
    },
    labelStyle: {
      fill: 'var(--text-secondary)',
      fontSize: 11,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: 'var(--bg-secondary)',
      fillOpacity: 0.9,
    },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
  };
}

// Inner component that uses useReactFlow (must be inside ReactFlowProvider)
function StoryCanvasInner() {
  const story = useStoryStore((s) => s.story);
  const updateNodePosition = useStoryStore((s) => s.updateNodePosition);
  const storeAddEdge = useStoryStore((s) => s.addEdge);
  const storeAddNode = useStoryStore((s) => s.addNode);
  const storeUpdateChoice = useStoryStore((s) => s.updateChoice);
  const storeAddChoice = useStoryStore((s) => s.addChoice);
  const storeRemoveNode = useStoryStore((s) => s.removeNode);
  const storeRemoveEdge = useStoryStore((s) => s.removeEdge);
  const undo = useStoryStore((s) => s.undo);
  const redo = useStoryStore((s) => s.redo);
  const canUndo = useStoryStore((s) => s.canUndo);
  const canRedo = useStoryStore((s) => s.canRedo);
  const selectNode = useEditorStore((s) => s.selectNode);

  const { screenToFlowPosition } = useReactFlow();

  // Add node type menu
  const [showAddMenu, setShowAddMenu] = useState(false);

  const flowNodes = useMemo(
    () => (story?.nodes || []).map(storyNodeToFlow),
    [story?.nodes]
  );

  const flowEdges = useMemo(
    () => (story?.edges || []).map((e) => storyEdgeToFlow(e, story?.nodes)),
    [story?.edges, story?.nodes]
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(flowEdges);

  // Wrap change handlers to sync deletions to Zustand store
  const onNodesChange = useCallback(
    (changes: any[]) => {
      // Filter out deletion of story-config node
      const filtered = changes.filter((c: any) => !(c.type === 'remove' && c.id === 'story-config'));
      onNodesChangeBase(filtered);
      for (const change of filtered) {
        if (change.type === 'remove') {
          storeRemoveNode(change.id);
        }
      }
    },
    [onNodesChangeBase, storeRemoveNode]
  );

  const onEdgesChange = useCallback(
    (changes: any[]) => {
      // Before applying changes, look up edge data for removals so we can clear choices
      for (const change of changes) {
        if (change.type === 'remove') {
          const edge = (story?.edges || []).find((e) => e.id === change.id);
          if (edge) {
            storeRemoveEdge(change.id);
            // Clear the choice's targetNodeId on the source node
            if (edge.sourceHandle && edge.source) {
              storeUpdateChoice(edge.source, edge.sourceHandle, { targetNodeId: '' });
            }
          }
        }
      }
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase, storeRemoveEdge, storeUpdateChoice, story?.edges]
  );

  // Sync when story changes (useEffect, not useMemo, for side effects)
  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  // ── Keyboard shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useStoryStore.getState().undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        useStoryStore.getState().redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !story) return;

      const sourceNode = (story.nodes || []).find((n) => n.id === params.source);
      const targetNode = (story.nodes || []).find((n) => n.id === params.target);
      const existingEdges = story.edges || [];

      // Prevent duplicate: if this sourceHandle already connects to a target, block it
      if (params.sourceHandle) {
        const alreadyConnected = existingEdges.some(
          (e) => e.source === params.source && e.sourceHandle === params.sourceHandle
        );
        if (alreadyConnected) return;
      } else {
        // Default handle (no choices) — block if any edge already exists from this source
        const alreadyConnected = existingEdges.some(
          (e) => e.source === params.source && (!e.sourceHandle || e.sourceHandle === '')
        );
        if (alreadyConnected) return;
      }

      // Resolve edge label and choice
      let edgeLabel = '';
      let choiceId = params.sourceHandle || '';

      if (choiceId && sourceNode) {
        const choice = sourceNode.data.choices?.find((c) => c.id === choiceId);
        if (choice) {
          // If choice text is empty, use target node title
          edgeLabel = choice.text || targetNode?.data.title || '';
          // Update choice text if it was empty
          if (!choice.text && targetNode?.data.title) {
            storeUpdateChoice(params.source, choiceId, {
              targetNodeId: params.target,
              text: targetNode.data.title,
            });
          } else {
            storeUpdateChoice(params.source, choiceId, {
              targetNodeId: params.target,
            });
          }
        }
      } else if (!choiceId && sourceNode) {
        // Default handle — auto-create a choice with target node's title
        const newChoiceId = uuid();
        const choiceText = targetNode?.data.title || '继续';
        edgeLabel = choiceText;
        choiceId = newChoiceId;
        storeAddChoice(params.source, {
          id: newChoiceId,
          text: choiceText,
          targetNodeId: params.target,
        });
      }

      setEdges((eds) => addEdge({ ...params, sourceHandle: choiceId, type: 'smoothstep', label: edgeLabel }, eds));

      const edgeId = `e-${params.source}-${params.target}-${Date.now()}`;
      const storyEdge: StoryEdge = {
        id: edgeId,
        source: params.source,
        target: params.target,
        sourceHandle: choiceId,
        label: edgeLabel,
        type: 'authored',
      };
      storeAddEdge(storyEdge);
    },
    [setEdges, storeAddEdge, storeUpdateChoice, storeAddChoice, story]
  );

  // Prevent connecting from a handle that's already connected to another node
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!story || !connection.source) return true;
      const existingEdges = story.edges || [];
      if (connection.sourceHandle) {
        return !existingEdges.some(
          (e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle
        );
      }
      // Default handle — block if any edge exists from this source without a specific handle
      return !existingEdges.some(
        (e) => e.source === connection.source && (!e.sourceHandle || e.sourceHandle === '')
      );
    },
    [story]
  );

  const onNodeDragStop = useCallback(
    (_: any, node: Node) => {
      updateNodePosition(node.id, node.position);
    },
    [updateNodePosition]
  );

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    setShowAddMenu(false);
  }, [selectNode]);

  // ── Add new node ──
  const handleAddNode = useCallback((nodeType: 'scene' | 'ending') => {
    if (!story) return;
    const existingNodes = (story.nodes || []).filter((n) => n.type !== 'story_config');
    // Position at center of current viewport
    let pos = { x: 300, y: 200 };
    try {
      pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    } catch { /* fallback */ }
    // Small random offset to avoid exact overlap if multiple nodes added
    pos.x += Math.round((Math.random() - 0.5) * 40);
    pos.y += Math.round((Math.random() - 0.5) * 40);

    const newNode: StoryNode = {
      id: uuid(),
      type: nodeType,
      position: pos,
      data: {
        title: nodeType === 'ending' ? '新结局' : '新场景',
        narration: '',
        dialogue: null,
        character: null,
        imageUrl: null,
        imagePrompt: '',
        audioUrl: null,
        choices: [],
        allowCustomInput: nodeType !== 'ending',
        depth: 0,
        voiceSegments: [],
        frames: [],
        metadata: { tags: [], storyContext: '' },
      },
    };
    storeAddNode(newNode);
    selectNode(newNode.id);
    setShowAddMenu(false);
  }, [story, storeAddNode, selectNode, screenToFlowPosition]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        panOnDrag
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: 'var(--border)', strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border)"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          style={{ marginBottom: 56, marginRight: 16 }}
        />
        <MiniMap
          position="bottom-left"
          style={{ marginBottom: 56, marginLeft: 16 }}
          nodeColor={(node) => {
            const nodeType = (node.data as any)?.nodeType || 'scene';
            const colors: Record<string, string> = {
              start: '#10B981',
              scene: '#6366F1',
              ending: '#EF4444',
              ai_generated: '#818CF8',
              story_config: '#c96442',
            };
            return colors[nodeType] || '#c96442';
          }}
          maskColor="rgba(242, 241, 237, 0.85)"
        />
      </ReactFlow>

      {/* ── Floating Bottom Toolbar ── */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-lg z-20"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        {/* Undo */}
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="p-1.5 rounded-md transition-colors disabled:opacity-25"
          style={{ color: 'var(--text-secondary)' }}
          title="撤销 (⌘Z)"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>

        {/* Redo */}
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="p-1.5 rounded-md transition-colors disabled:opacity-25"
          style={{ color: 'var(--text-secondary)' }}
          title="重做 (⌘⇧Z)"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </button>

        {/* Divider */}
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--border)' }} />

        {/* Add Node */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新增节点
          </button>

          {/* Dropdown menu */}
          {showAddMenu && (
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-lg overflow-hidden py-0.5 min-w-[120px]"
              style={{
                background: 'var(--bg-tertiary)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                border: '1px solid var(--border)',
              }}
            >
              <button
                onClick={() => handleAddNode('scene')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--node-scene)' }} />
                场景节点
              </button>
              <button
                onClick={() => handleAddNode('ending')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--node-ending)' }} />
                结局节点
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Wrapper with ReactFlowProvider (required for useReactFlow)
export default function StoryCanvas() {
  return (
    <ReactFlowProvider>
      <StoryCanvasInner />
    </ReactFlowProvider>
  );
}
