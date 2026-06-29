// ============================================================
// Core Data Types for Interactive Image Story Game
// ============================================================

// ---------- Story ----------

export interface PlayerObjective {
  primary: string;
  hidden: string;
  measurement: string;
}

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
  style: StyleConfig | null;
  playerObjective?: PlayerObjective | null;
  entities?: EntityCollection | null;
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

export type FrameMediaType = 'image' | 'video' | 'gif';

export interface Frame {
  id: string;
  narrationSegment: string;  // 该画面对应的叙述文本
  imagePrompt: string;
  imageUrl: string | null;
  mediaType?: FrameMediaType; // 默认 'image'
  mediaUrl?: string | null;   // 视频/GIF URL（mediaType 非 image 时使用）
  entityRefs?: string[];      // 引用的实体 ID（角色/场景/道具）
  duration: number;           // 建议展示时长（秒），默认 3
}

/** 将每个配音段按比例钉到对应帧（生成时调用一次，写入 frameId 锚点）。
 *  之后增删段不会再让其他段漂移——因为归属由 frameId 决定，而非数组位置比例。 */
export function assignSegmentFrames(frames: Frame[], voiceSegments: VoiceSegment[]): VoiceSegment[] {
  const F = frames.length;
  const V = voiceSegments.length;
  if (F === 0 || V === 0) return voiceSegments;
  if (F === 1) return voiceSegments.map((s) => ({ ...s, frameId: frames[0].id }));
  return voiceSegments.map((s, i) => {
    // 与历史比例边界一致：段 i 属于 floor(i*F/V) 那一帧
    const fi = Math.min(Math.floor(i * F / V), F - 1);
    return { ...s, frameId: frames[fi].id };
  });
}

/** 取某一帧拥有的配音段（带原始下标）。优先用 frameId 锚点；旧数据无锚点时回退按比例切片。 */
export function getSegmentsOfFrame(
  frames: Frame[],
  voiceSegments: VoiceSegment[],
  frameIndex: number,
): { seg: VoiceSegment; globalIndex: number }[] {
  const F = frames.length;
  const V = voiceSegments.length;
  if (F === 0 || V === 0 || frameIndex < 0 || frameIndex >= F) return [];
  const frameId = frames[frameIndex].id;
  const anchored = voiceSegments.some((s) => s.frameId);
  if (anchored) {
    return voiceSegments
      .map((seg, globalIndex) => ({ seg, globalIndex }))
      .filter(({ seg }) => seg.frameId === frameId);
  }
  // Legacy fallback: proportional slice
  const start = Math.floor(frameIndex * V / F);
  const end = Math.floor((frameIndex + 1) * V / F);
  return voiceSegments.slice(start, end).map((seg, j) => ({ seg, globalIndex: start + j }));
}

/** 语音生成后，将 voiceSegments 文字回写到 frames 的 narrationSegment。
 *  优先按 frameId 锚点分组；旧数据无锚点时回退按比例。 */
export function syncFramesFromVoice(frames: Frame[], voiceSegments: VoiceSegment[]): Frame[] {
  if (frames.length === 0 || voiceSegments.length === 0) return frames;

  const fullText = voiceSegments.map((s) => s.text).join('\n\n');

  if (frames.length === 1) {
    return [{ ...frames[0], narrationSegment: fullText }];
  }

  const anchored = voiceSegments.some((s) => s.frameId);
  if (anchored) {
    return frames.map((f) => {
      const text = voiceSegments.filter((s) => s.frameId === f.id).map((s) => s.text).join('\n');
      return { ...f, narrationSegment: text || f.narrationSegment };
    });
  }

  return frames.map((f, i) => {
    const startSeg = Math.floor(i * voiceSegments.length / frames.length);
    const endSeg = Math.floor((i + 1) * voiceSegments.length / frames.length);
    const text = voiceSegments.slice(startSeg, endSeg).map((s) => s.text).join('\n');
    return { ...f, narrationSegment: text || f.narrationSegment };
  });
}

/** 构建「线性已走故事线」：严格按 PlaySession.history 的顺序拼接每个节点的叙述（再加上当前节点）。
 *  ⚠️ 必须基于 history（线性路径），不能基于所有生成过的节点——history 经 goBack 会 pop 掉被放弃的
 *  分支尝试，所以这里得到的是「从故事起点到当前节点」真正经历的那一条线，不含放弃的兄弟分支，避免
 *  把矛盾的支线情节喂给 LLM。超长时保留开场 + 最近部分。 */
export function buildStoryline(
  nodes: { id: string; data: { title?: string; narration?: string } }[],
  history: { nodeId: string; customInput?: string | null }[],
  currentNodeId: string,
  maxChars = 9000,
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  const seen = new Set<string>();
  const pushNode = (id: string, customInput?: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId.get(id);
    const narr = (n?.data?.narration || '').trim();
    if (narr) parts.push(narr);
    if (customInput) parts.push(`（你的选择：${customInput}）`);
  };
  for (const step of history || []) pushNode(step.nodeId, step.customInput);
  pushNode(currentNodeId); // current node isn't in history yet
  const full = parts.join('\n');
  if (full.length <= maxChars) return full;
  // Too long: keep the opening (first ~1500 chars) + the most recent (rest of the budget).
  const head = full.slice(0, 1500);
  const tail = full.slice(full.length - (maxChars - 1500));
  return `${head}\n……（中间剧情略）……\n${tail}`;
}

/** 删除「孤儿配音段」：frameId 指向已不存在帧的段。仅在 ≥2 帧且存在锚点时生效，
 *  与编辑器面板 getSegmentsOfFrame 的可见性规则保持一致（0/1 帧时面板会显示全部段，故不处理）。
 *  无变化时返回原数组引用。 */
export function dropOrphanSegments(frames: Frame[], voiceSegments: VoiceSegment[]): VoiceSegment[] {
  if (frames.length < 2 || voiceSegments.length === 0) return voiceSegments;
  const anchored = voiceSegments.some((s) => s.frameId);
  if (!anchored) return voiceSegments;
  const ids = new Set(frames.map((f) => f.id));
  const kept = voiceSegments.filter((s) => s.frameId && ids.has(s.frameId));
  return kept.length === voiceSegments.length ? voiceSegments : kept;
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
  constrainIntents?: boolean;            // 限制自由输入意图方向
  constrainIntentChoiceIds?: string[];   // 允许的选项 ID 列表
  depth: number; // 当前层级 (0-based)
  voiceSegments: VoiceSegment[];
  frames: Frame[];             // 多画面帧，空数组 = 兼容旧单图模式
  metadata: {
    tags: string[];
    storyContext: string;
    convergenceTarget?: string;   // For converge_bridge nodes: target mainline node ID
    convergenceHint?: string;     // Hint for bridge narration direction
    bridgeDepth?: number;         // How many bridge steps taken so far
    endingType?: 'normal' | 'good' | 'bad' | 'best' | 'hidden';  // For ending nodes
  };
}

export type ChoiceVisibility = 'visible' | 'hidden';

export interface Choice {
  id: string;
  text: string;
  targetNodeId: string;
  visibility?: ChoiceVisibility;  // default: 'visible'
}

export interface VoiceSegment {
  id: string;
  text: string;
  speaker: string; // 'narrator' | character name
  voiceType: VoiceType;
  emotion: string;
  speed: number;
  audioUrl?: string | null;
  frameId?: string | null; // 该段归属的帧 id（锚点）；缺省时回退按比例映射
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

// Achievement tracking per story (max once each per story)
export interface StoryAchievements {
  completed?: boolean;       // 完成一个非隐藏结局
  hiddenUnlocked?: boolean;  // 成功解锁隐藏结局
}

export interface PlayStep {
  nodeId: string;
  choiceId: string | null;
  customInput: string | null;
  wasAiGenerated: boolean;
  timestamp: string;
}

// ---------- AI Branch (C-side) ----------

export type BranchAction = 'reject' | 'navigate_existing' | 'converge_to_main' | 'route_to_ending';

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
  playerObjective?: {
    primary: string;         // Player's known goal
    hidden: string;          // Hidden truth only revealed on certain paths
    measurement: string;     // Dimensions for measuring goal progress
  };
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
    isDecisionPoint?: boolean;
    strategyOptions?: string[];
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
