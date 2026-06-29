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
import { assignSegmentFrames, dropOrphanSegments } from '@/types/story';

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
  setEntities: (entities: import('@/types/story').EntityCollection | null) => void;
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

  // Voice segment operations
  addVoiceSegment: (nodeId: string, segment: import('@/types/story').VoiceSegment) => void;
  removeVoiceSegment: (nodeId: string, segIndex: number) => void;
  updateVoiceSegment: (nodeId: string, segIndex: number, updates: Partial<import('@/types/story').VoiceSegment>) => void;

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
      nodes: [{
        id: 'story-config',
        type: 'story_config' as const,
        position: { x: 0, y: 0 },
        data: {
          title, narration: '', dialogue: null, character: null,
          imageUrl: null, imagePrompt: '', audioUrl: null,
          choices: [], allowCustomInput: false, depth: -1,
          voiceSegments: [], frames: [],
          metadata: { tags: [], storyContext: '' },
        },
      }],
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
      entities: null,
    };
    set({ story, past: [], future: [] });
  },

  setStory: (story) => {
    const hist = pushHistory(get());
    // Self-heal: strip orphaned voice segments (frameId pointing at a frame that no longer exists,
    // e.g. left behind when frames were regenerated with new ids). They are invisible in the
    // per-frame panel but would otherwise be saved and played back. Cleaned on load so the next
    // save persists the fix.
    const nodes = (story.nodes || []).map((n) => {
      const segs = n.data?.voiceSegments;
      if (!segs || segs.length === 0) return n;
      const cleaned = dropOrphanSegments(n.data.frames || [], segs);
      return cleaned === segs ? n : { ...n, data: { ...n.data, voiceSegments: cleaned } };
    });
    set({ story: { ...story, nodes, updatedAt: new Date().toISOString() }, ...hist });
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

  setEntities: (entities) => {
    const { story } = get();
    if (!story) return;
    set({ story: { ...story, entities, updatedAt: new Date().toISOString() } });
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
                  // Drop voice segments anchored to the removed frame — otherwise they
                  // become orphans: hidden in the per-frame panel but still played back
                  // (the player iterates all segments and maps unmatched frameIds to the
                  // last frame).
                  voiceSegments: (n.data.voiceSegments || []).filter((v) => v.frameId !== frameId),
                },
              }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  addVoiceSegment: (nodeId, segment) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) => {
          if (n.id !== nodeId) return n;
          const frames = n.data.frames || [];
          // Backfill frameId on legacy segments (preserve current grouping) so anchoring is
          // consistent. Do NOT re-derive narrationSegment — frame text is independent of voice.
          let existing = n.data.voiceSegments || [];
          if (frames.length > 0 && existing.some((s) => !s.frameId)) existing = assignSegmentFrames(frames, existing);
          let segs = [...existing, segment];
          // Keep playback order aligned with frame order — appending to the end would make a
          // segment added to an earlier frame play after later frames (playback is array-ordered).
          if (frames.length > 1) {
            const order = new Map(frames.map((f, i) => [f.id, i]));
            segs = segs
              .map((s, i) => ({ s, i }))
              .sort((a, b) =>
                ((order.get(a.s.frameId as string) ?? frames.length) - (order.get(b.s.frameId as string) ?? frames.length)) ||
                (a.i - b.i),
              )
              .map((x) => x.s);
          }
          return { ...n, data: { ...n.data, voiceSegments: segs } };
        }),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  removeVoiceSegment: (nodeId, segIndex) => {
    const { story } = get();
    if (!story) return;
    const hist = pushHistory(get());
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) => {
          if (n.id !== nodeId) return n;
          const frames = n.data.frames || [];
          // Anchor legacy segments first (frameId) so deleting one doesn't re-proportion the rest.
          // narrationSegment is left untouched — deleting voice must not erase the frame's text.
          let segs = n.data.voiceSegments || [];
          if (frames.length > 0 && segs.some((s) => !s.frameId)) segs = assignSegmentFrames(frames, segs);
          segs = segs.filter((_, i) => i !== segIndex);
          return { ...n, data: { ...n.data, voiceSegments: segs } };
        }),
        updatedAt: new Date().toISOString(),
      },
      ...hist,
    });
  },

  updateVoiceSegment: (nodeId, segIndex, updates) => {
    const { story } = get();
    if (!story) return;
    set({
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, voiceSegments: (n.data.voiceSegments || []).map((s, i) => i === segIndex ? { ...s, ...updates } : s) } }
            : n
        ),
        updatedAt: new Date().toISOString(),
      },
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
