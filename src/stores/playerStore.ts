import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { Story, StoryNode, PlaySession, PlayStep, BranchAction, UserGeneratedBranch } from '@/types/story';

interface PlayerState {
  story: Story | null;
  session: PlaySession | null;
  currentNode: StoryNode | null;
  isNarrating: boolean;
  isBranching: boolean;
  branchingMessage: string;
  generatedBranches: UserGeneratedBranch[];

  initSession: (story: Story) => void;
  restoreSession: (story: Story, serverSession: PlaySession) => void;
  setSessionServerId: (id: string) => void;
  navigate: (choiceId: string) => void;
  navigateToNode: (targetNodeId: string, choiceText?: string) => void;
  submitCustomInput: (input: string) => void;
  setBranchResult: (action: BranchAction, node?: StoryNode) => void;
  goBack: () => void;
  setNarrating: (v: boolean) => void;
  setBranching: (v: boolean, message?: string) => void;
  setCurrentNode: (node: StoryNode) => void;
  addGeneratedNodes: (nodes: StoryNode[]) => void;
  updateGeneratedNode: (nodeId: string, data: Partial<StoryNode['data']>) => void;
  updateFrameImage: (nodeId: string, frameId: string, imageUrl: string) => void;
  addGeneratedBranch: (branch: UserGeneratedBranch) => void;
  findMatchingBranch: (parentNodeId: string, playerInput: string) => UserGeneratedBranch | null;
}

export const usePlayerStore = create<PlayerState>()(persist((set, get) => ({
  story: null,
  session: null,
  currentNode: null,
  isNarrating: false,
  isBranching: false,
  branchingMessage: '',
  generatedBranches: [],

  initSession: (story) => {
    // Strip any AI-generated nodes that may be riding along (e.g. rehydrated from persisted
    // localStorage). A fresh session must start from the authored story only — otherwise a cleared
    // server session gets re-polluted from the client's old in-memory/persisted copy.
    const cleanStory = { ...story, nodes: (story.nodes || []).filter((n) => n.type !== 'ai_generated') };
    const nodes = (cleanStory.nodes || []).filter((n) => n.type !== 'story_config');
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0];
    if (!startNode) {
      set({ story: cleanStory, session: null, currentNode: null });
      return;
    }
    const session: PlaySession = {
      id: uuid(),
      storyId: cleanStory.id,
      playerId: null,
      currentNodeId: startNode.id,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set({ story: cleanStory, session, currentNode: startNode });
  },

  // Adopt an existing server session: restore id, history and playback position.
  restoreSession: (story, serverSession) => {
    const playable = (story.nodes || []).filter((n) => n.type !== 'story_config');
    const startNode = playable.find((n) => n.type === 'start') || playable[0];
    // Resolve the saved position to a PLAYABLE node. A story_config id (or a missing id) would
    // render blank, so fall back: last playable node in history, else the start node.
    const saved = (story.nodes || []).find((n) => n.id === serverSession.currentNodeId);
    let currentNode = saved && saved.type !== 'story_config' ? saved : null;
    if (!currentNode) {
      const hist = Array.isArray(serverSession.history) ? serverSession.history : [];
      for (let i = hist.length - 1; i >= 0; i--) {
        const n = playable.find((p) => p.id === hist[i].nodeId);
        if (n) { currentNode = n; break; }
      }
    }
    currentNode = currentNode || startNode || null;
    if (!currentNode) { set({ story, session: null, currentNode: null }); return; }
    set({
      story,
      session: {
        id: serverSession.id,
        storyId: story.id,
        playerId: serverSession.playerId ?? null,
        currentNodeId: currentNode.id,
        history: Array.isArray(serverSession.history) ? serverSession.history : [],
        createdAt: serverSession.createdAt || new Date().toISOString(),
        updatedAt: serverSession.updatedAt || new Date().toISOString(),
      },
      currentNode,
    });
  },

  // Adopt the DB row id after POST-creating a session, so later PUTs target a real row.
  setSessionServerId: (id) => set((s) => (s.session ? { session: { ...s.session, id } } : {})),

  navigate: (choiceId) => {
    const { story, session, currentNode } = get();
    if (!story || !session || !currentNode) return;

    const choice = currentNode.data.choices?.find((c) => c.id === choiceId);
    if (!choice) return;

    const targetNode = (story.nodes || []).find((n) => n.id === choice.targetNodeId);
    if (!targetNode) return;

    const step: PlayStep = {
      nodeId: currentNode.id,
      choiceId,
      customInput: null,
      wasAiGenerated: false,
      timestamp: new Date().toISOString(),
    };

    set({
      currentNode: targetNode,
      session: {
        ...session,
        currentNodeId: targetNode.id,
        history: [...session.history, step],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  navigateToNode: (targetNodeId, choiceText) => {
    const { story, session, currentNode } = get();
    if (!story || !session || !currentNode) return;

    const targetNode = (story.nodes || []).find((n) => n.id === targetNodeId);
    if (!targetNode) return;
    // Guard: the story-config node has no narration/frames/voice — navigating to it shows a
    // blank (white) screen. A stale convergence target could point here; refuse and stay put.
    if (targetNode.type === 'story_config') {
      console.warn('[player] refused navigation to story_config node', targetNodeId);
      return;
    }

    const step: PlayStep = {
      nodeId: currentNode.id,
      choiceId: null,
      customInput: choiceText || null,
      wasAiGenerated: false,
      timestamp: new Date().toISOString(),
    };

    set({
      currentNode: targetNode,
      session: {
        ...session,
        currentNodeId: targetNode.id,
        history: [...session.history, step],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  submitCustomInput: (input) => {
    const { session, currentNode } = get();
    if (!session || !currentNode) return;

    const step: PlayStep = {
      nodeId: currentNode.id,
      choiceId: null,
      customInput: input,
      wasAiGenerated: true,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...session,
        history: [...session.history, step],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  setBranchResult: (action, node) => {
    if (node) {
      set((state) => ({
        currentNode: node,
        isBranching: false,
        branchingMessage: '',
        session: state.session ? { ...state.session, currentNodeId: node.id } : null,
      }));
    } else {
      set({ isBranching: false });
    }
  },

  goBack: () => {
    const { story, session } = get();
    if (!story || !session || session.history.length === 0) return;

    // Pop history until we hit a step whose node still exists. A step can point to a
    // dynamic node (e.g. an AI bridge node) that was lost on session restore; skipping
    // it lets goBack land on the nearest resolvable node instead of silently no-op-ing.
    const history = [...session.history];
    let prevNode: StoryNode | undefined;
    while (history.length > 0) {
      const step = history.pop()!;
      prevNode = (story.nodes || []).find((n) => n.id === step.nodeId);
      if (prevNode) break;
    }
    if (!prevNode) return;

    set({
      currentNode: prevNode,
      session: {
        ...session,
        currentNodeId: prevNode.id,
        history,
        updatedAt: new Date().toISOString(),
      },
    });
  },

  setNarrating: (v) => set({ isNarrating: v }),
  setBranching: (v, message) => set({ isBranching: v, branchingMessage: message || '' }),
  setCurrentNode: (node) => set((state) => ({
    currentNode: node,
    session: state.session ? {
      ...state.session,
      currentNodeId: node.id,
    } : null,
  })),

  addGeneratedNodes: (nodes) => {
    const { story } = get();
    if (!story) return;
    set({
      story: {
        ...story,
        nodes: [...(story.nodes || []), ...nodes],
      },
    });
  },

  updateGeneratedNode: (nodeId, data) => {
    const { story, currentNode } = get();
    if (!story) return;
    const updates: Record<string, any> = {
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        ),
      },
    };
    // Also update currentNode if it's the one being updated
    if (currentNode?.id === nodeId) {
      updates.currentNode = { ...currentNode, data: { ...currentNode.data, ...data } };
    }
    set(updates);
  },

  updateFrameImage: (nodeId, frameId, imageUrl) => {
    const { story, currentNode } = get();
    if (!story) return;
    const updateFrames = (frames: any[]) =>
      frames.map((f: any) => f.id === frameId ? { ...f, imageUrl } : f);
    const updates: Record<string, any> = {
      story: {
        ...story,
        nodes: (story.nodes || []).map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, frames: updateFrames(n.data.frames || []) } } : n
        ),
      },
    };
    if (currentNode?.id === nodeId) {
      updates.currentNode = { ...currentNode, data: { ...currentNode.data, frames: updateFrames(currentNode.data.frames || []) } };
    }
    set(updates);
  },

  addGeneratedBranch: (branch) => {
    set((s) => ({ generatedBranches: [...s.generatedBranches, branch] }));
  },

  findMatchingBranch: (parentNodeId, playerInput) => {
    const { generatedBranches } = get();
    // Normalize: lowercase, remove punctuation/spaces
    const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, '');
    const input = normalize(playerInput);
    return generatedBranches.find((b) => {
      if (b.parentNodeId !== parentNodeId) return false;
      return normalize(b.playerInput) === input;
    }) || null;
  },
}), {
  name: 'player-store',
  // Persist NOTHING that can resurrect server-cleared content. The play page always re-fetches the
  // story + session from the server on load, so persisting story/session/currentNode/generatedBranches
  // only caused a stale localStorage copy (incl. old AI nodes) to clobber the freshly-loaded data and
  // re-POST/PUT the deleted nodes back — making server-side clears impossible to stick. Persist an
  // empty object so the store always starts from server truth.
  partialize: () => ({}),
}));
