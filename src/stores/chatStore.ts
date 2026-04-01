import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ChatMessage, SkillName, SkillState, OrchestratorState, AgentMode,
  InteractiveBranchState, PendingExpansion, NodeProposal, INITIAL_INTERACTIVE_BRANCH,
} from '@/lib/agent/types';
import { INITIAL_INTERACTIVE_BRANCH as INIT_IB } from '@/lib/agent/types';
import type { StyleConfig, StoryOutline, EntityCollection } from '@/types/story';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  orchestrator: OrchestratorState;

  // ReAct mode
  agentMode: AgentMode;
  reactLoopActive: boolean;
  setAgentMode: (mode: AgentMode) => void;
  setReactLoopActive: (active: boolean) => void;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (v: boolean) => void;
  clearMessages: () => void;

  // Orchestrator
  setCurrentSkill: (skill: SkillName | null) => void;
  updateSkillStatus: (name: SkillName, status: SkillState['status']) => void;
  setStoryDescription: (desc: string) => void;
  setSelectedStyle: (style: StyleConfig) => void;
  setOutline: (outline: StoryOutline) => void;
  setEntities: (entities: EntityCollection) => void;
  updateEntityImage: (type: 'characters' | 'scenes' | 'props', id: string, imageUrl: string) => void;
  updateEntityField: (type: 'characters' | 'scenes' | 'props', id: string, field: string, value: any) => void;
  confirmSkill: (messageId: string) => void;

  // Interactive branch co-creation
  setInteractiveBranch: (partial: Partial<InteractiveBranchState>) => void;
  addPendingExpansion: (expansion: PendingExpansion) => void;
  removePendingExpansion: (parentNodeId: string, choiceId: string) => void;
  clearInteractiveBranch: () => void;
}

const initialSkills: SkillState[] = [
  { name: 'styleConfirm', status: 'idle' },
  { name: 'outlineGenerator', status: 'idle' },
  { name: 'branchGenerator', status: 'idle' },
  { name: 'entityExtractor', status: 'idle' },
  { name: 'storyboardGenerator', status: 'idle' },
  { name: 'voiceGenerator', status: 'idle' },
];

export const useChatStore = create<ChatState>()(persist((set, get) => ({
  messages: [],
  isStreaming: false,
  agentMode: 'pipeline' as AgentMode,
  reactLoopActive: false,
  setAgentMode: (mode) => set({ agentMode: mode }),
  setReactLoopActive: (active) => set({ reactLoopActive: active }),
  orchestrator: {
    currentSkill: null,
    skills: [...initialSkills],
    storyDescription: '',
    style: null,
    outline: null,
    entities: null,
    interactiveBranch: { ...INIT_IB },
  },

  addMessage: (msg) => {
    const message: ChatMessage = {
      ...msg,
      id: uuid(),
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, message] }));
  },

  updateLastAssistantMessage: (content) => {
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { messages: msgs };
    });
  },

  setStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [], orchestrator: { ...get().orchestrator, currentSkill: null, skills: [...initialSkills], interactiveBranch: { ...INIT_IB } } }),

  setCurrentSkill: (skill) =>
    set((s) => ({
      orchestrator: { ...s.orchestrator, currentSkill: skill },
    })),

  updateSkillStatus: (name, status) =>
    set((s) => ({
      orchestrator: {
        ...s.orchestrator,
        skills: s.orchestrator.skills.map((sk) =>
          sk.name === name ? { ...sk, status } : sk
        ),
      },
    })),

  setStoryDescription: (desc) =>
    set((s) => ({
      orchestrator: { ...s.orchestrator, storyDescription: desc },
    })),

  setSelectedStyle: (style) =>
    set((s) => ({
      orchestrator: { ...s.orchestrator, style },
    })),

  setOutline: (outline) =>
    set((s) => ({
      orchestrator: { ...s.orchestrator, outline },
    })),

  setEntities: (entities) =>
    set((s) => ({
      orchestrator: { ...s.orchestrator, entities },
    })),

  updateEntityImage: (type: 'characters' | 'scenes' | 'props', id: string, imageUrl: string) =>
    set((s) => {
      if (!s.orchestrator.entities) return s;
      const entities = { ...s.orchestrator.entities };
      entities[type] = entities[type].map((e: any) =>
        e.id === id ? { ...e, imageUrl } : e
      );
      return { orchestrator: { ...s.orchestrator, entities } };
    }),

  updateEntityField: (type: 'characters' | 'scenes' | 'props', id: string, field: string, value: any) =>
    set((s) => {
      if (!s.orchestrator.entities) return s;
      const entities = { ...s.orchestrator.entities };
      entities[type] = entities[type].map((e: any) =>
        e.id === id ? { ...e, [field]: value } : e
      );
      return { orchestrator: { ...s.orchestrator, entities } };
    }),

  confirmSkill: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, confirmed: true } : m
      ),
    })),

  // Interactive branch co-creation
  setInteractiveBranch: (partial) =>
    set((s) => ({
      orchestrator: {
        ...s.orchestrator,
        interactiveBranch: { ...s.orchestrator.interactiveBranch, ...partial },
      },
    })),

  addPendingExpansion: (expansion) =>
    set((s) => ({
      orchestrator: {
        ...s.orchestrator,
        interactiveBranch: {
          ...s.orchestrator.interactiveBranch,
          // Prepend: DFS — new child branches go to front so we follow current storyline first
          pendingExpansions: [expansion, ...s.orchestrator.interactiveBranch.pendingExpansions],
        },
      },
    })),

  removePendingExpansion: (parentNodeId, choiceId) =>
    set((s) => ({
      orchestrator: {
        ...s.orchestrator,
        interactiveBranch: {
          ...s.orchestrator.interactiveBranch,
          pendingExpansions: s.orchestrator.interactiveBranch.pendingExpansions.filter(
            (p) => !(p.parentNodeId === parentNodeId && p.choiceId === choiceId),
          ),
        },
      },
    })),

  clearInteractiveBranch: () =>
    set((s) => ({
      orchestrator: {
        ...s.orchestrator,
        interactiveBranch: { ...INIT_IB },
      },
    })),
}), {
  name: 'chat-store',
  partialize: (state) => ({
    messages: state.messages,
    orchestrator: state.orchestrator,
    agentMode: state.agentMode,
  }),
  merge: (persisted: any, current) => {
    const merged = { ...current, ...persisted };
    // Ensure interactiveBranch always has defaults (persisted state from before this field existed won't have it)
    if (merged.orchestrator && !merged.orchestrator.interactiveBranch) {
      merged.orchestrator = { ...merged.orchestrator, interactiveBranch: { ...INIT_IB } };
    }
    return merged;
  },
}));
