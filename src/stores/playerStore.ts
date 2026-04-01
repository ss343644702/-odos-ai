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
    const nodes = story.nodes || [];
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0];
    const session: PlaySession = {
      id: uuid(),
      storyId: story.id,
      playerId: null,
      currentNodeId: startNode.id,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set({ story, session, currentNode: startNode });
  },

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

    const history = [...session.history];
    const lastStep = history.pop()!;
    const prevNode = (story.nodes || []).find((n) => n.id === lastStep.nodeId);
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

  addGeneratedBranch: (branch) => {
    set((s) => ({ generatedBranches: [...s.generatedBranches, branch] }));
  },

  findMatchingBranch: (parentNodeId, playerInput) => {
    const { generatedBranches } = get();
    const input = playerInput.toLowerCase().trim();
    return generatedBranches.find((b) => {
      if (b.parentNodeId !== parentNodeId) return false;
      const cached = b.playerInput.toLowerCase().trim();
      // Character overlap > 70%
      const inputChars = [...input];
      const matchCount = inputChars.filter((ch) => cached.includes(ch)).length;
      return matchCount / Math.max(inputChars.length, 1) > 0.7;
    }) || null;
  },
}), {
  name: 'player-store',
  partialize: (state) => ({
    story: state.story,
    session: state.session,
    currentNode: state.currentNode,
    generatedBranches: state.generatedBranches,
  }),
}));
