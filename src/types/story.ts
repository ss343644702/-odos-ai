// ============================================================
// Core Data Types for Interactive Image Story Game
// ============================================================

// ---------- Story ----------

export interface Story {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  authorId: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
  nodes: StoryNode[];
  edges: StoryEdge[];
  settings: StorySettings;
  worldView: string;
  style: StyleConfig;
}

export interface StorySettings {
  defaultVoice: string;
  imageStyle: string;
  language: string;
  maxDepth: number; // ≤ 10
  endingCount: number; // 2-4
}

export interface StyleConfig {
  styleId: string;
  styleName: string;
  stylePromptPrefix: string;
  colorTone: string;
  lightingStyle: string;
}

// ---------- Story Node ----------

export type NodeType = 'start' | 'scene' | 'ending' | 'ai_generated' | 'story_config';

export interface StoryNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: StoryNodeData;
}

export interface Frame {
  id: string;
  narrationSegment: string;  // 该画面对应的叙述文本
  imagePrompt: string;
  imageUrl: string | null;
  entityRefs?: string[];     // 引用的实体 ID（角色/场景/道具）
  duration: number;          // 建议展示时长（秒），默认 3
}

/** 语音生成后，将 voiceSegments 文字回写到 frames 的 narrationSegment */
export function syncFramesFromVoice(frames: Frame[], voiceSegments: VoiceSegment[]): Frame[] {
  if (frames.length === 0 || voiceSegments.length === 0) return frames;

  const fullText = voiceSegments.map((s) => s.text).join('\n\n');

  if (frames.length === 1) {
    return [{ ...frames[0], narrationSegment: fullText }];
  }

  return frames.map((f, i) => {
    const startSeg = Math.floor(i * voiceSegments.length / frames.length);
    const endSeg = Math.floor((i + 1) * voiceSegments.length / frames.length);
    const text = voiceSegments.slice(startSeg, endSeg).map((s) => s.text).join('\n');
    return { ...f, narrationSegment: text || f.narrationSegment };
  });
}

/** 兼容 helper: 优先返回 frames，否则从 imageUrl/imagePrompt 合成单帧 */
export function getDisplayFrames(data: StoryNodeData): Frame[] {
  if (data.frames && data.frames.length > 0) return data.frames;
  if (data.imagePrompt || data.imageUrl) {
    return [{
      id: 'legacy-0',
      narrationSegment: data.narration,
      imagePrompt: data.imagePrompt,
      imageUrl: data.imageUrl,
      duration: 5,
    }];
  }
  return [];
}

export interface StoryNodeData {
  title: string;
  narration: string;
  dialogue: string | null;
  character: string | null;
  imageUrl: string | null;
  imagePrompt: string;
  audioUrl: string | null;
  choices: Choice[];
  allowCustomInput: boolean;
  depth: number; // 当前层级 (0-based)
  voiceSegments: VoiceSegment[];
  frames: Frame[];             // 多画面帧，空数组 = 兼容旧单图模式
  metadata: {
    tags: string[];
    storyContext: string;
  };
}

export interface Choice {
  id: string;
  text: string;
  targetNodeId: string;
}

export interface VoiceSegment {
  id: string;
  text: string;
  speaker: string; // 'narrator' | character name
  voiceType: VoiceType;
  emotion: string;
  speed: number;
  audioUrl?: string | null;
}

export type VoiceType =
  | 'narrator'
  | 'young_male'
  | 'mature_male'
  | 'young_female'
  | 'mature_female'
  | 'elder'
  | 'child';

// ---------- Story Edge ----------

export interface StoryEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  label: string;
  type: 'authored' | 'ai_generated';
}

// ---------- Entities (Skill 3 output) ----------

export interface Character {
  id: string;
  name: string;
  description: string;
  appearance: string;
  personality: string;
  gender: 'male' | 'female' | 'other';
  ageRange: string;
  voiceType: VoiceType;
  imagePrompt: string;
  imageUrl: string | null;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  mood: string;
  lighting: string;
  imagePrompt: string;
  imageUrl: string | null;
}

export interface Prop {
  id: string;
  name: string;
  description: string;
  significance: string;
  imagePrompt: string;
  imageUrl: string | null;
}

export interface EntityCollection {
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}

// ---------- Storyboard (Skill 4 output) ----------

export interface Storyboard {
  nodeId: string;
  narration: string;
  dialogue: string | null;
  character: string | null;
  scene: string;
  imagePrompt: string; // 组合后的完整 prompt（第一帧/兼容）
  cameraAngle: string;
  mood: string;
  frames: {
    narrationSegment: string;
    imagePrompt: string;
    entityRefs?: string[];
    duration: number;
  }[];
}

// ---------- Play Session (C-side) ----------

export interface PlaySession {
  id: string;
  storyId: string;
  playerId: string | null;
  currentNodeId: string;
  history: PlayStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PlayStep {
  nodeId: string;
  choiceId: string | null;
  customInput: string | null;
  wasAiGenerated: boolean;
  timestamp: string;
}

// ---------- AI Branch (C-side) ----------

export type BranchAction = 'reject' | 'navigate_existing' | 'converge_to_main' | 'new_ending';

export interface BranchRequest {
  storyId: string;
  currentNodeId: string;
  playerInput: string;
  history: PlayStep[];
  worldView: string;
  mainPlotNodeIds: string[];
  existingChoices: Choice[];
}

export interface BranchResponse {
  action: BranchAction;
  message?: string; // reject message: "在想什么呢，重新做一个选择吧"
  targetNodeId?: string; // for navigate_existing
  newNodes?: StoryNode[]; // for converge_to_main / new_ending
  newEdges?: StoryEdge[];
  transitionNarration?: string; // 描述用户选择后果的过渡文字
}

export interface UserGeneratedBranch {
  id: string;
  storyId: string;
  parentNodeId: string;
  playerInput: string;
  generatedNodes: StoryNode[];
  generatedEdges: StoryEdge[];
  usageCount: number;
  createdAt: string;
}

// ---------- Outline (Skill 1 output) ----------

export interface StoryOutline {
  theme: string;
  worldView: string;
  tone: string;
  depth: number;
  characters: {
    name: string;
    role: string;
    description: string;
    gender: 'male' | 'female' | 'other';
    secret?: string;
  }[];
  // New "交织叙事" format
  plotPoints?: {
    id: string;
    title: string;
    description: string;
    hook?: string;
    dilemma?: string;
    stakes?: string;
    conflict?: string;
    suspense?: string;
  }[];
  narrativeRoutes?: {
    id: string;
    name: string;
    perspective: string;
    uniqueInfo: string;
    emotionalTone?: string;
  }[];
  convergencePoints?: string[];
  // Legacy "钻石型" format (backward compat)
  mainPlotPoints?: {
    id: string;
    title: string;
    description: string;
    hook?: string;
    conflict?: string;
    suspense?: string;
  }[];
  mainlinePath?: string[];
  branchPoints?: string[];
  endings: {
    id: string;
    title: string;
    type: 'best' | 'good' | 'normal' | 'bad' | 'hidden';
    description: string;
    requirement?: string;
  }[];
}
