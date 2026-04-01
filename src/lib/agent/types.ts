import type {
  StyleConfig,
  StoryOutline,
  StoryNode,
  StoryEdge,
  EntityCollection,
  Storyboard,
  VoiceSegment,
} from '@/types/story';

// ============================================================
// Agent Skill Types
// ============================================================

export type SkillName =
  | 'styleConfirm'
  | 'outlineGenerator'
  | 'branchGenerator'
  | 'entityExtractor'
  | 'storyboardGenerator'
  | 'voiceGenerator';

export type SkillStatus = 'idle' | 'running' | 'waiting_confirm' | 'completed' | 'error';

export interface SkillState {
  name: SkillName;
  status: SkillStatus;
  progress?: number; // 0-100
  error?: string;
}

// ---------- Skill 0: Style Confirm ----------

export interface StyleConfirmInput {
  storyDescription: string;
}

export interface StyleConfirmOutput {
  style: StyleConfig;
  previewPrompt: string;
}

export const PRESET_STYLES: StyleConfig[] = [
  {
    styleId: 'cinematic_realistic',
    styleName: '写实电影风',
    stylePromptPrefix: 'cinematic realistic photography, dramatic lighting, film grain, 8k, ',
    colorTone: 'warm neutral',
    lightingStyle: 'dramatic natural',
  },
  {
    styleId: 'cyberpunk',
    styleName: '赛博朋克',
    stylePromptPrefix: 'cyberpunk style, neon lights, futuristic city, holographic, dark atmosphere, ',
    colorTone: 'neon blue purple',
    lightingStyle: 'neon glow',
  },
  {
    styleId: 'ink_wash',
    styleName: '水墨国风',
    stylePromptPrefix: 'Chinese ink wash painting style, traditional, misty mountains, elegant, ',
    colorTone: 'monochrome with red accents',
    lightingStyle: 'soft diffused',
  },
  {
    styleId: 'anime',
    styleName: '动漫风',
    stylePromptPrefix: 'anime style, vivid colors, detailed illustration, studio quality, ',
    colorTone: 'vibrant saturated',
    lightingStyle: 'bright clean',
  },
  {
    styleId: 'dark_gothic',
    styleName: '暗黑哥特',
    stylePromptPrefix: 'dark gothic style, moody atmosphere, shadows, ornate details, ',
    colorTone: 'dark desaturated',
    lightingStyle: 'low key dramatic',
  },
  {
    styleId: 'watercolor',
    styleName: '水彩绘本',
    stylePromptPrefix: 'watercolor illustration, soft edges, pastel colors, storybook style, ',
    colorTone: 'pastel soft',
    lightingStyle: 'soft ambient',
  },
];

// ---------- Skill 1: Outline Generator ----------

export interface OutlineGeneratorInput {
  storyDescription: string;
  style: StyleConfig;
}

export interface OutlineGeneratorOutput {
  outline: StoryOutline;
}

// ---------- Skill 2: Branch Generator ----------

export interface BranchGeneratorInput {
  outline: StoryOutline;
  style: StyleConfig;
  targetNodeId?: string; // optional: regenerate branches for specific node
}

export interface BranchGeneratorOutput {
  nodes: StoryNode[];
  edges: StoryEdge[];
  selfReview: {
    rating: number; // 1-10
    strengths: string[];
    issues: string[];
    fixes: string[];
  };
}

// ---------- Skill 3: Entity Extractor ----------

export interface EntityExtractorInput {
  nodes: StoryNode[];
  outline: StoryOutline;
  style: StyleConfig;
}

export interface EntityExtractorOutput {
  entities: EntityCollection;
}

// ---------- Skill 4: Storyboard Generator ----------

export interface StoryboardGeneratorInput {
  node: StoryNode;
  entities: EntityCollection;
  style: StyleConfig;
}

export interface StoryboardGeneratorOutput {
  storyboard: Storyboard;
}

// ---------- Skill 5: Voice Generator ----------

export interface VoiceGeneratorInput {
  node: StoryNode;
  storyboard: Storyboard;
  entities: EntityCollection;
}

export interface VoiceGeneratorOutput {
  voiceSegments: VoiceSegment[];
  voiceScript: string; // 完整口语化配音脚本
}

// ---------- Agent Mode ----------

export type AgentMode = 'pipeline' | 'react';

// ---------- Interactive Branch Co-Creation ----------

/** AI 生成的节点提案，供创作者选择 */
export interface NodeProposal {
  id: string;
  title: string;
  narrationPreview: string;
  direction: string;
  isEnding?: boolean;
  fullNode: {
    title: string;
    narration: string;
    dialogue: string | null;
    character: string | null;
    imagePrompt: string;
    choices: { text: string }[];
  };
}

/** 待展开的分支 */
export interface PendingExpansion {
  parentNodeId: string;
  choiceId: string;
  choiceText: string;
  depth: number;
}

export type InteractiveBranchPhase =
  | 'idle'
  | 'generating'
  | 'waiting_creator'
  | 'applying'
  | 'auto_completing';

export interface InteractiveBranchState {
  active: boolean;
  proposals: NodeProposal[];
  pendingExpansions: PendingExpansion[];
  completedNodeIds: string[];
  currentExpansion: PendingExpansion | null;
  maxDepth: number;
  phase: InteractiveBranchPhase;
}

export const INITIAL_INTERACTIVE_BRANCH: InteractiveBranchState = {
  active: false,
  proposals: [],
  pendingExpansions: [],
  completedNodeIds: [],
  currentExpansion: null,
  maxDepth: 10,
  phase: 'idle',
};

// ---------- Chat Message ----------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  skillName?: SkillName;
  skillOutput?: unknown;
  confirmRequired?: boolean;
  confirmed?: boolean;
  /** Interactive branch: proposals for creator to choose from */
  proposals?: NodeProposal[];
  /** ReAct: agent's reasoning (collapsed in UI) */
  reactThought?: string;
  /** ReAct: tool that produced this message */
  reactTool?: string;
  /** ReAct: loop is paused waiting for user */
  waitingForUser?: boolean;
}

// ---------- Orchestrator ----------

export interface OrchestratorState {
  currentSkill: SkillName | null;
  skills: SkillState[];
  storyDescription: string;
  style: StyleConfig | null;
  outline: StoryOutline | null;
  entities: EntityCollection | null;
  interactiveBranch: InteractiveBranchState;
}
