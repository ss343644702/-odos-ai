import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  ChatMessage, SkillName, SkillState, OrchestratorState,
  InteractiveBranchState, PendingExpansion, NodeProposal, INITIAL_INTERACTIVE_BRANCH,
} from '@/lib/agent/types';
import { INITIAL_INTERACTIVE_BRANCH as INIT_IB } from '@/lib/agent/types';
import type { StyleConfig, StoryOutline, EntityCollection } from '@/types/story';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  orchestrator: OrchestratorState;
  currentStoryId: string | null;

  // ReAct mode (pipeline removed)
  reactLoopActive: boolean;
  setReactLoopActive: (active: boolean) => void;
  switchProject: (storyId: string) => void;

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
  addEntity: (type: 'characters' | 'scenes' | 'props', entity: any) => void;
  removeEntity: (type: 'characters' | 'scenes' | 'props', id: string) => void;
  confirmSkill: (messageId: string) => void;

  // Outline CRUD
  updateOutlineField: (field: string, value: any) => void;
  addOutlineCharacter: (char: StoryOutline['characters'][0]) => void;
  removeOutlineCharacter: (index: number) => void;
  updateOutlineCharacter: (index: number, field: string, value: any) => void;
  addOutlineEnding: (ending: StoryOutline['endings'][0]) => void;
  removeOutlineEnding: (index: number) => void;
  updateOutlineEnding: (index: number, field: string, value: any) => void;
  addOutlinePlotPoint: (point: NonNullable<StoryOutline['plotPoints']>[0]) => void;
  removeOutlinePlotPoint: (index: number) => void;
  updateOutlinePlotPoint: (index: number, field: string, value: any) => void;

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
  currentStoryId: null,
  reactLoopActive: false,
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
  clearMessages: () => set({
    messages: [],
    orchestrator: {
      currentSkill: null,
      skills: [...initialSkills],
      storyDescription: '',
      style: null,
      outline: null,
      entities: null,
      interactiveBranch: { ...INIT_IB },
    },
  }),

  switchProject: (storyId) => {
    const { currentStoryId, messages, orchestrator } = get();
    // Save current project's chat to localStorage
    if (currentStoryId && messages.length > 0) {
      try {
        localStorage.setItem(`chat-${currentStoryId}`, JSON.stringify({ messages, orchestrator }));
      } catch { /* quota exceeded */ }
    }
    // Load target project's chat from localStorage
    try {
      const saved = localStorage.getItem(`chat-${storyId}`);
      if (saved) {
        const { messages: savedMsgs, orchestrator: savedOrch } = JSON.parse(saved);
        set({ currentStoryId: storyId, messages: savedMsgs || [], orchestrator: savedOrch || get().orchestrator });
        return;
      }
    } catch { /* parse error */ }
    // No saved chat — clear for fresh start
    set({
      currentStoryId: storyId,
      messages: [],
      orchestrator: {
        currentSkill: null,
        skills: [...initialSkills],
        storyDescription: '',
        style: null,
        outline: null,
        entities: null,
        interactiveBranch: { ...INIT_IB },
      },
    });
  },

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

  addEntity: (type, entity) =>
    set((s) => {
      const entities = s.orchestrator.entities
        ? { ...s.orchestrator.entities }
        : { characters: [], scenes: [], props: [] };
      entities[type] = [...entities[type], entity];
      return { orchestrator: { ...s.orchestrator, entities } };
    }),

  removeEntity: (type, id) =>
    set((s) => {
      if (!s.orchestrator.entities) return s;
      const entities = { ...s.orchestrator.entities };
      (entities as any)[type] = (entities[type] as any[]).filter((e: any) => e.id !== id);
      return { orchestrator: { ...s.orchestrator, entities } };
    }),

  confirmSkill: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, confirmed: true } : m
      ),
    })),

  // Outline CRUD
  updateOutlineField: (field, value) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, [field]: value } } };
    }),

  addOutlineCharacter: (char) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const outline = { ...s.orchestrator.outline, characters: [...s.orchestrator.outline.characters, char] };
      return { orchestrator: { ...s.orchestrator, outline } };
    }),

  removeOutlineCharacter: (index) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const characters = s.orchestrator.outline.characters.filter((_, i) => i !== index);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, characters } } };
    }),

  updateOutlineCharacter: (index, field, value) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const characters = s.orchestrator.outline.characters.map((c, i) => i === index ? { ...c, [field]: value } : c);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, characters } } };
    }),

  addOutlineEnding: (ending) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const endings = [...s.orchestrator.outline.endings, ending];
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, endings } } };
    }),

  removeOutlineEnding: (index) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const endings = s.orchestrator.outline.endings.filter((_, i) => i !== index);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, endings } } };
    }),

  updateOutlineEnding: (index, field, value) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const endings = s.orchestrator.outline.endings.map((e, i) => i === index ? { ...e, [field]: value } : e);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, endings } } };
    }),

  addOutlinePlotPoint: (point) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const plotPoints = [...(s.orchestrator.outline.plotPoints || []), point];
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, plotPoints } } };
    }),

  removeOutlinePlotPoint: (index) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const plotPoints = (s.orchestrator.outline.plotPoints || []).filter((_, i) => i !== index);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, plotPoints } } };
    }),

  updateOutlinePlotPoint: (index, field, value) =>
    set((s) => {
      if (!s.orchestrator.outline) return s;
      const plotPoints = (s.orchestrator.outline.plotPoints || []).map((p, i) => i === index ? { ...p, [field]: value } : p);
      return { orchestrator: { ...s.orchestrator, outline: { ...s.orchestrator.outline, plotPoints } } };
    }),

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
    currentStoryId: state.currentStoryId,
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
