import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  Story,
  StoryNode,
  StoryEdge,
  StoryNodeData,
  Choice,
  Frame,
  StyleConfig,
  EntityCollection,
} from '@/types/story';

interface StoryState {
  story: Story | null;
  // Past states for undo
  past: Story[];
  future: Story[];

  // Actions
  initStory: (title: string, description: string) => void;
  setStory: (story: Story) => void;
  updateTitle: (title: string) => void;
  setStyle: (style: StyleConfig) => void;
  setWorldView: (worldView: string) => void;
  setPlayerObjective: (objective: import('@/types/story').PlayerObjective | null) => void;
  updateSettings: (updates: Partial<Story['settings']>) => void;

  // Node operations
  addNode: (node: StoryNode) => void;
  updateNode: (nodeId: string, data: Partial<StoryNodeData>) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;

  // Edge operations
  addEdge: (edge: StoryEdge) => void;
  removeEdge: (edgeId: string) => void;

  // Batch operations
  setNodesAndEdges: (nodes: StoryNode[], edges: StoryEdge[]) => void;
  addNodesAndEdges: (nodes: StoryNode[], edges: StoryEdge[]) => void;

  // Choice operations
  addChoice: (nodeId: string, choice: Choice) => void;
  updateChoice: (nodeId: string, choiceId: string, updates: Partial<Choice>) => void;
  removeChoice: (nodeId: string, choiceId: string) => void;

  // Frame operations
  updateFrame: (nodeId: string, frameId: string, updates: Partial<Frame>) => void;
  addFrame: (nodeId: string, frame: Frame) => void;
  removeFrame: (nodeId: string, frameId: string) => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function pushHistory(state: StoryState): Pick<StoryState, 'past' | 'future'> {
  if (!state.story) return { past: state.past, future: [] };
  return {
    past: [...state.past.slice(-49), JSON.parse(JSON.stringify(state.story))],
    future: [],
  };
}

export const useStoryStore = create<StoryState>()(persist((set, get) => ({
  story: null,
  past: [],
  future: [],

  initStory: (title, description) => {
    const story: Story = {
      id: uuid(),
      title,
      description,
      coverImageUrl: null,
      authorId: 'local',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      settings: {
        defaultVoice: 'narrator',
        imageStyle: 'cinematic_realistic',
        language: 'zh-CN',
        maxDepth: 12,
        endingCount: 3,
      },
      worldView: '',
      style: null,
      playerObjective: null,
    };
    set({ story, past: [], future: [] });
  },

  setStory: (story) => {
    const hist = pushHistory(get());
    set({ story: { ...story, updatedAt: new Date().toISOString() }, ...hist });
  },

  updateTitle: (title) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        title,
        nodes: (story.nodes || []).map(n =>
          n.type === 'story_config' ? { ...n, data: { ...n.data, title } } : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  setStyle: (style) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({ story: { ...story, style, updatedAt: new Date().toISOString() }, ...hist });
  },

  setWorldView: (worldView) => {
    const { story } = get();
    if (!story) return;
    set({ story: { ...story, worldView, updatedAt: new Date().toISOString() } });
  },

  setPlayerObjective: (objective) => {
    const { story } = get();
    if (!story) return;
    set({ story: { ...story, playerObjective: objective, updatedAt: new Date().toISOString() } });
  },

  updateSettings: (updates) => {
    const { story } = get();
    if (!story) return;
    set({ story: { ...story, settings: { ...story.settings, ...updates }, updatedAt: new Date().toISOString() } });
  },

  addNode: (node) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: [...(story.nodes || []), node],
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  updateNode: (nodeId, data) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  updateNodePosition: (nodeId, position) => {
    const { story } = get();
    if (!story) return;
    // Position changes don't push to undo history (too frequent)
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) => (n.id === nodeId ? { ...n, position } : n)),
      },
    });
  },

  removeNode: (nodeId) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).filter((n) => n.id !== nodeId),
        edges: (story.edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  addEdge: (edge) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        edges: [...(story.edges || []), edge],
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  removeEdge: (edgeId) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        edges: (story.edges || []).filter((e) => e.id !== edgeId),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  setNodesAndEdges: (nodes, edges) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: { ...story, nodes, edges, updatedAt: new Date().toISOString() },
      ...hist,
    });
  },

  addNodesAndEdges: (nodes, edges) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: [...(story.nodes || []), ...nodes],
        edges: [...(story.edges || []), ...edges],
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  addChoice: (nodeId, choice) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, choices: [...n.data.choices, choice] } }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  updateChoice: (nodeId, choiceId, updates) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  choices: n.data.choices.map((c) =>
                    c.id === choiceId ? { ...c, ...updates } : c
                  ),
                },
              }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  removeChoice: (nodeId, choiceId) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  choices: n.data.choices.filter((c) => c.id !== choiceId),
                },
              }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  updateFrame: (nodeId, frameId, updates) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  frames: (n.data.frames || []).map((f) =>
                    f.id === frameId ? { ...f, ...updates } : f
                  ),
                },
              }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  addFrame: (nodeId, frame) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, frames: [...(n.data.frames || []), frame] } }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  removeFrame: (nodeId, frameId) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  frames: (n.data.frames || []).filter((f) => f.id !== frameId),
                },
              }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  undo: () => {
    const { past, story, future } = get();
    if (past.length === 0 || !story) return;
    const prev = past[past.length - 1];
    set({
      story: prev,
      past: past.slice(0, -1),
      future: [JSON.parse(JSON.stringify(story)), ...future],
    });
  },

  redo: () => {
    const { past, story, future } = get();
    if (future.length === 0 || !story) return;
    const next = future[0];
    set({
      story: next,
      past: [...past, JSON.parse(JSON.stringify(story))],
      future: future.slice(1),
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}), {
  name: 'story-store',
  partialize: (state) => ({
    story: state.story,
  }),
}));
