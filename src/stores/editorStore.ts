import { create } from 'zustand';

interface EditorState {
  selectedNodeId: string | null;
  agentPanelOpen: boolean;
  paramPanelOpen: boolean;
  isGeneratingImage: boolean;
  isGeneratingStory: boolean;
  previewOpen: boolean;
  publishDialogOpen: boolean;

  selectNode: (nodeId: string | null) => void;
  toggleAgentPanel: () => void;
  setAgentPanelOpen: (open: boolean) => void;
  setParamPanelOpen: (open: boolean) => void;
  setGeneratingImage: (v: boolean) => void;
  setGeneratingStory: (v: boolean) => void;
  setPreviewOpen: (v: boolean) => void;
  setPublishDialogOpen: (v: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedNodeId: null,
  agentPanelOpen: true,
  paramPanelOpen: false,
  isGeneratingImage: false,
  isGeneratingStory: false,
  previewOpen: false,
  publishDialogOpen: false,

  selectNode: (nodeId) =>
    set({ selectedNodeId: nodeId, paramPanelOpen: nodeId !== null }),

  toggleAgentPanel: () =>
    set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),

  setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),
  setParamPanelOpen: (open) => set({ paramPanelOpen: open }),
  setGeneratingImage: (v) => set({ isGeneratingImage: v }),
  setGeneratingStory: (v) => set({ isGeneratingStory: v }),
  setPreviewOpen: (v) => set({ previewOpen: v }),
  setPublishDialogOpen: (v) => set({ publishDialogOpen: v }),
}));
