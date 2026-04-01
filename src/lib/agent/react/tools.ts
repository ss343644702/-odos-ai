import type { ToolName, ToolExecutor, ToolObservation, ToolContext } from './types';
import { PRESET_STYLES } from '../types';
import type { PendingExpansion, NodeProposal } from '../types';
import { useChatStore } from '@/stores/chatStore';
import { useStoryStore } from '@/stores/storyStore';
import { syncFramesFromVoice } from '@/types/story';
import type { Story, StoryNode, StoryEdge } from '@/types/story';
import { layoutNodes } from '@/lib/layout';
import { getEntityImageList } from '@/lib/entity-utils';
import { submitImageGeneration, pollImageResult } from '@/lib/keling';
import { v4 as uuid } from 'uuid';

// ============================================================
// Helper: call skill API with SSE streaming support
// ============================================================

/** Skills that benefit from streaming (long-running LLM calls) */
const STREAMABLE_SKILLS = new Set([
  'outlineGenerator', 'branchGenerator', 'entityExtractor',
  'storyboardGenerator', 'voiceGenerator', 'expandNode',
]);

async function callSkillAPI(
  skill: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  // Use streaming for heavy skills, fall back to non-streaming on any failure
  if (STREAMABLE_SKILLS.has(skill)) {
    try {
      const res = await fetch('/api/generate-story-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, input }),
        signal,
      });
      if (!res.ok || !res.body) {
        return callSkillAPINonStream(skill, input, signal);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr);
            if (event.type === 'done') result = event.result;
            else if (event.type === 'error') throw new Error(event.message);
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
      if (!result) throw new Error(`Skill ${skill}: no result from stream`);
      return result;
    } catch (streamErr: any) {
      // Stream failed — fallback to non-streaming (has retry + MiniMax fallback)
      console.log(`[callSkillAPI] Stream failed for ${skill}: ${streamErr.message}, falling back to non-streaming`);
      return callSkillAPINonStream(skill, input, signal);
    }
  }

  return callSkillAPINonStream(skill, input, signal);
}

/** Non-streaming fallback */
async function callSkillAPINonStream(
  skill: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const res = await fetch('/api/generate-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, input }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'API call failed');
  }
  return res.json();
}

// ============================================================
// Tool Executors
// ============================================================

const selectStyle: ToolExecutor = async (input) => {
  const styleId = input.styleId as string;
  const style = PRESET_STYLES.find((s) => s.styleId === styleId);
  if (!style) {
    const available = PRESET_STYLES.map((s) => `${s.styleId}(${s.styleName})`).join(', ');
    return {
      tool: 'select_style', success: false,
      result: `未找到风格 "${styleId}"。可选风格：${available}`,
    };
  }
  useChatStore.getState().setSelectedStyle(style);
  useStoryStore.getState().setStyle(style);
  return {
    tool: 'select_style', success: true,
    result: `已选择风格：${style.styleName}（${style.colorTone}，${style.lightingStyle}）`,
    data: style,
  };
};

const generateOutline: ToolExecutor = async (input, ctx) => {
  const { orchestrator } = useChatStore.getState();
  const desc = (input.storyDescription as string) || orchestrator.storyDescription;
  const style = orchestrator.style;
  if (!desc) return { tool: 'generate_outline', success: false, result: '缺少故事描述' };
  if (!style) return { tool: 'generate_outline', success: false, result: '请先选择风格（select_style）' };

  ctx.updateMessage('📋 正在生成剧本大纲...');
  const outline = await callSkillAPI('outlineGenerator', {
    storyDescription: desc,
    style,
    depth: input.depth,
  }, ctx.signal);

  useChatStore.getState().setOutline(outline);
  if (outline.worldView) useStoryStore.getState().setWorldView(outline.worldView);

  // Build a rich summary so the LLM (and user via ask_user) can see the actual story
  const charSummary = (outline.characters || [])
    .map((c: any) => `${c.name}(${c.role})${c.secret ? `[秘密: ${c.secret}]` : ''}`)
    .join('\n  ');
  // Support both new plotPoints and old mainPlotPoints
  const plotPoints = outline.plotPoints || outline.mainPlotPoints || [];
  const plotSummary = plotPoints
    .map((p: any, i: number) => `${i + 1}. ${p.title}：${p.description}${p.conflict ? `\n   冲突：${p.conflict}` : ''}${p.suspense ? `\n   悬念：${p.suspense}` : ''}`)
    .join('\n');
  const endingSummary = (outline.endings || [])
    .map((e: any) => `[${e.type}] ${e.title}：${e.description}${e.requirement ? `（条件：${e.requirement}）` : ''}`)
    .join('\n');

  const richResult = [
    `大纲生成完成`,
    `\n📖 主题：${outline.theme}`,
    outline.worldView ? `🌍 世界观：${outline.worldView}` : '',
    `🎭 基调：${outline.tone || '未指定'}`,
    `📊 层级深度：${outline.depth} 层`,
    `\n👥 角色（${outline.characters?.length || 0}）：\n  ${charSummary}`,
    plotSummary ? `\n📋 情节脉络：\n${plotSummary}` : '',
    endingSummary ? `\n🏁 结局方向（${outline.endings?.length || 0}）：\n${endingSummary}` : '',
  ].filter(Boolean).join('\n');

  return {
    tool: 'generate_outline', success: true,
    result: richResult,
    data: outline,
  };
};

function inferNodeType(n: any, i: number): 'start' | 'scene' | 'ending' {
  const type = n.type || n.data?.type;
  if (type && ['start', 'scene', 'ending'].includes(type)) return type;
  if (i === 0) return 'start';
  const choices = n.data?.choices || n.choices || [];
  if (choices.length === 0) {
    const title = (n.data?.title || n.title || '').toLowerCase();
    const id = (n.id || '').toLowerCase();
    if (/结局|ending|end/.test(title) || /ending|end/.test(id)) return 'ending';
  }
  return 'scene';
}

function checkEndingIssues(nodes: StoryNode[], edges: StoryEdge[]): string[] {
  const issues: string[] = [];
  const sourceIds = new Set(edges.map(e => e.source));
  const leafNodes = nodes.filter(n =>
    n.type !== 'story_config' &&
    !sourceIds.has(n.id) &&
    n.data.choices.length === 0
  );
  const danglingLeaves = leafNodes.filter(n => n.type !== 'ending');
  if (danglingLeaves.length > 0) {
    issues.push(`⚠️ ${danglingLeaves.length} 个叶子节点不是结局类型：${danglingLeaves.map(n => `"${n.data.title}"(${n.id})`).join('、')}。请用 manage_node 为它们添加后续剧情或将它们改为结局节点。`);
  }
  const endingCount = nodes.filter(n => n.type === 'ending').length;
  if (endingCount === 0) {
    issues.push('⚠️ 没有任何结局节点！请补充结局。');
  } else if (endingCount < 2) {
    issues.push(`⚠️ 只有 ${endingCount} 个结局节点，建议至少 2 个。`);
  }
  return issues;
}

/** Repair common structural issues in LLM-generated branch trees */
function repairBranchStructure(
  nodes: StoryNode[],
  edges: StoryEdge[],
): { nodes: StoryNode[]; edges: StoryEdge[]; repairs: string[] } {
  const repairs: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 1. Fix choices with invalid targetNodeId
  for (const node of nodes) {
    for (const choice of node.data.choices) {
      if (choice.targetNodeId && !nodeIds.has(choice.targetNodeId)) {
        // Try to find a node with a similar ID (e.g., "node_2" vs "node2")
        const stripped = choice.targetNodeId.replace(/[_-]/g, '');
        const match = nodes.find((n) => n.id.replace(/[_-]/g, '') === stripped);
        if (match) {
          repairs.push(`修复: 选项"${choice.text}"目标 ${choice.targetNodeId} → ${match.id}`);
          choice.targetNodeId = match.id;
        } else {
          repairs.push(`警告: 选项"${choice.text}"指向不存在的节点 ${choice.targetNodeId}，已移除`);
          choice.targetNodeId = '';
        }
      }
    }
    // Remove choices with empty targetNodeId
    node.data.choices = node.data.choices.filter((c) => c.targetNodeId);
  }

  // 2. Force leaf nodes (no outgoing choices) to be endings
  const nodesWithChoices = new Set(nodes.filter((n) => n.data.choices.length > 0).map((n) => n.id));
  for (const node of nodes) {
    if (node.data.choices.length === 0 && node.type !== 'ending' && node.type !== 'story_config') {
      repairs.push(`修复: 叶子节点"${node.data.title}"(${node.id}) 标记为结局`);
      (node as any).type = 'ending';
      node.data.allowCustomInput = false;
    }
  }

  // 3. Ensure edges are generated for every choice (choices are the source of truth)
  const existingEdgeKeys = new Set(edges.map((e) => `${e.source}->${e.target}`));
  for (const node of nodes) {
    for (const choice of node.data.choices) {
      const key = `${node.id}->${choice.targetNodeId}`;
      if (!existingEdgeKeys.has(key)) {
        edges.push({
          id: uuid(),
          source: node.id,
          target: choice.targetNodeId,
          sourceHandle: choice.id,
          label: choice.text,
          type: 'authored',
        });
        existingEdgeKeys.add(key);
        repairs.push(`修复: 补充缺失的边 ${node.id} → ${choice.targetNodeId}`);
      }
    }
  }

  // 4. Remove edges pointing to non-existent nodes
  const validEdges = edges.filter((e) => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      repairs.push(`修复: 移除无效边 ${e.source} → ${e.target}`);
      return false;
    }
    return true;
  });

  // 5. Ensure at least 2 endings exist
  const endingCount = nodes.filter((n) => n.type === 'ending').length;
  if (endingCount === 0) {
    repairs.push('警告: 没有结局节点！');
  } else if (endingCount < 2) {
    repairs.push(`警告: 只有 ${endingCount} 个结局节点，建议至少 2 个`);
  }

  return { nodes, edges: validEdges, repairs };
}

const generateBranches: ToolExecutor = async (_input, ctx) => {
  const { orchestrator } = useChatStore.getState();
  if (!orchestrator.outline) return { tool: 'generate_branches', success: false, result: '请先生成大纲（generate_outline）' };
  if (!orchestrator.style) return { tool: 'generate_branches', success: false, result: '请先选择风格（select_style）' };

  ctx.updateMessage('🌳 正在生成分支剧情树...');
  const result = await callSkillAPI('branchGenerator', {
    outline: orchestrator.outline,
    style: orchestrator.style,
  }, ctx.signal);

  const review = result.selfReview;

  // Normalize nodes — same post-processing as pipeline mode (AgentChat.tsx:202-228)
  const nodes: StoryNode[] = (result.nodes || []).map((n: any, i: number) => ({
    id: n.id || uuid(),
    type: inferNodeType(n, i),
    position: n.position || { x: 0, y: 0 },
    data: {
      title: n.data?.title || n.title || `节点${i + 1}`,
      narration: n.data?.narration || n.narration || '',
      dialogue: n.data?.dialogue || n.dialogue || null,
      character: n.data?.character || n.character || null,
      imageUrl: n.data?.imageUrl || null,
      imagePrompt: n.data?.imagePrompt || n.imagePrompt || '',
      audioUrl: null,
      choices: (n.data?.choices || n.choices || []).map((c: any) => ({
        id: c.id || uuid(),
        text: c.text || '',
        targetNodeId: c.targetNodeId || c.target || '',
      })),
      allowCustomInput: (n.type === 'ending') ? false : (n.data?.allowCustomInput ?? n.allowCustomInput ?? true),
      depth: n.data?.depth ?? n.depth ?? 0,
      voiceSegments: [],
      frames: [],
      metadata: {
        tags: n.data?.metadata?.tags || [],
        storyContext: n.data?.metadata?.storyContext || '',
      },
    },
  }));

  // Fix edge sourceHandle to match choice IDs — same as pipeline mode (AgentChat.tsx:230-265)
  const nodeChoiceMap = new Map<string, Map<string, string>>();
  for (const node of nodes) {
    const targetToChoice = new Map<string, string>();
    for (const c of node.data.choices) {
      if (c.targetNodeId) targetToChoice.set(c.targetNodeId, c.id);
    }
    nodeChoiceMap.set(node.id, targetToChoice);
  }

  const edges: StoryEdge[] = (result.edges || []).map((e: any) => {
    let sourceHandle = e.sourceHandle || '';
    if (!sourceHandle || sourceHandle.startsWith('choice-')) {
      const targetMap = nodeChoiceMap.get(e.source);
      if (targetMap) {
        sourceHandle = targetMap.get(e.target) || sourceHandle;
      }
    }
    if (!sourceHandle) {
      const srcNode = nodes.find((n) => n.id === e.source);
      if (srcNode?.data.choices.length) {
        sourceHandle = srcNode.data.choices[0].id;
      }
    }
    return {
      id: e.id || uuid(),
      source: e.source,
      target: e.target,
      sourceHandle,
      label: e.label || '',
      type: (e.type as 'authored' | 'ai_generated') || 'authored',
    };
  });

  // Structural repair: fix invalid refs, leaf nodes, missing edges
  const repaired = repairBranchStructure(nodes, edges);
  const repairedEdges = repaired.edges;
  const structureRepairs = repaired.repairs;

  // Check for ending issues
  const endingIssues = checkEndingIssues(nodes, repairedEdges);

  // Layout + config node — same as pipeline mode
  if (nodes.length > 0) {
    const layoutedNodes = layoutNodes(nodes, repairedEdges);

    const rootNode = layoutedNodes.find((n) => n.type === 'start') || layoutedNodes[0];
    const configNode: StoryNode = {
      id: 'story-config',
      type: 'story_config' as const,
      position: { x: rootNode?.position?.x || 0, y: (rootNode?.position?.y || 0) - 120 },
      data: {
        title: useStoryStore.getState().story?.title || '故事配置',
        narration: '', dialogue: null, character: null,
        imageUrl: null, imagePrompt: '', audioUrl: null,
        choices: [], allowCustomInput: false, depth: -1,
        voiceSegments: [], frames: [],
        metadata: { tags: [], storyContext: '' },
      },
    };

    useStoryStore.getState().setNodesAndEdges([configNode, ...layoutedNodes], repairedEdges);
  }

  const summary = `分支剧情生成完成：${nodes.length}个节点，${repairedEdges.length}条边${review ? `，自检评分 ${review.rating}/10` : ''}`;
  const allIssues = [...structureRepairs, ...endingIssues];
  const resultText = allIssues.length > 0
    ? `${summary}\n\n结构修复：\n${allIssues.join('\n')}`
    : summary;

  return {
    tool: 'generate_branches', success: true,
    result: resultText,
    data: result,
  };
};

// ============================================================
// Interactive Branch Co-Creation Tools
// ============================================================

/** Calculate choices per node based on depth and progress */
function calcChoiceCount(depth: number, maxDepth: number, totalNodes: number): number {
  const depthPct = maxDepth > 0 ? depth / maxDepth : 0;
  if (totalNodes >= 25) return 0;
  if (depthPct >= 0.7 || totalNodes > 15) return 1;
  if (depthPct >= 0.4) return 2;
  return 2;
}

/** Build the branch path from root to a given node */
function getBranchPath(nodeId: string): string[] {
  const story = useStoryStore.getState().story;
  if (!story) return [];
  const path: string[] = [];
  let currentId = nodeId;
  let safety = 20;
  while (currentId && safety-- > 0) {
    const node = story.nodes.find(n => n.id === currentId);
    if (!node) break;
    path.unshift(node.data.title);
    const inEdge = story.edges.find(e => e.target === currentId);
    currentId = inEdge?.source || '';
  }
  return path;
}

/** Helper: build expand context and call expandNode API */
async function callExpandNodeAPI(
  expansion: PendingExpansion,
  signal?: AbortSignal,
): Promise<NodeProposal[]> {
  const ib = useChatStore.getState().orchestrator.interactiveBranch;
  const outline = useChatStore.getState().orchestrator.outline;
  const story = useStoryStore.getState().story;
  if (!outline) throw new Error('没有大纲');

  // For root expansion, use outline theme as parent context
  const isRoot = expansion.parentNodeId === '__root__';
  const parentNode = isRoot
    ? { data: { title: '故事开场', narration: outline.worldView || outline.theme } }
    : story?.nodes.find(n => n.id === expansion.parentNodeId);
  if (!parentNode) throw new Error(`找不到父节点: ${expansion.parentNodeId}`);

  const existingNodes = (story?.nodes || [])
    .filter(n => n.type !== 'story_config')
    .map(n => ({ id: n.id, title: n.data.title, depth: n.data.depth, type: n.type }));

  const choiceCount = calcChoiceCount(expansion.depth, ib.maxDepth, existingNodes.length);
  const branchPath = isRoot ? [] : getBranchPath(expansion.parentNodeId);

  const result = await callSkillAPI('expandNode', {
    parentNode: { title: parentNode.data.title, narration: parentNode.data.narration },
    choiceText: expansion.choiceText,
    existingNodes,
    outline: {
      theme: outline.theme,
      tone: outline.tone,
      worldView: outline.worldView,
      characters: outline.characters || [],
      endings: outline.endings || [],
    },
    depth: expansion.depth,
    maxDepth: ib.maxDepth,
    openBranches: ib.pendingExpansions.length,
    totalNodes: existingNodes.length,
    choiceCount,
    branchPath,
  }, signal) as { proposals: any[] };

  return (result.proposals || []).map((p: any, i: number) => ({
    id: `p${i + 1}`,
    title: p.title || `方案${i + 1}`,
    narrationPreview: p.narrationPreview || p.fullNode?.narration?.slice(0, 80) || '',
    direction: p.direction || '',
    isEnding: p.isEnding || false,
    fullNode: p.fullNode || {},
  }));
}

/** Helper: apply a proposal — create node, edge, update pending expansions */
function applyProposalToStory(proposal: NodeProposal, expansion: PendingExpansion): string {
  const story = useStoryStore.getState().story;
  if (!story) throw new Error('没有故事数据');

  const { addNode, addEdge, updateChoice } = useStoryStore.getState();
  const { setInteractiveBranch, addPendingExpansion, removePendingExpansion } = useChatStore.getState();
  const ib = useChatStore.getState().orchestrator.interactiveBranch;

  const nodeId = `node_${uuid().slice(0, 8)}`;
  const isRoot = expansion.parentNodeId === '__root__';
  const nodeType = proposal.isEnding ? 'ending' : (expansion.depth === 0 ? 'start' : 'scene');
  const choices = proposal.isEnding ? [] : (proposal.fullNode.choices || []).map((c: any) => ({
    id: `c_${uuid().slice(0, 6)}`,
    text: c.text,
    targetNodeId: '',
  }));

  // Position
  const parentNode = story.nodes.find(n => n.id === expansion.parentNodeId);
  const parentPos = parentNode?.position || { x: 0, y: 0 };
  const siblingCount = story.nodes.filter(n =>
    story.edges.some(e => e.source === expansion.parentNodeId && e.target === n.id)
  ).length;

  const newNode: StoryNode = {
    id: nodeId,
    type: nodeType,
    position: { x: parentPos.x + (siblingCount * 300 - 150), y: parentPos.y + 200 },
    data: {
      title: proposal.fullNode.title || proposal.title,
      narration: proposal.fullNode.narration || '',
      dialogue: proposal.fullNode.dialogue || null,
      character: proposal.fullNode.character || null,
      imageUrl: null,
      imagePrompt: proposal.fullNode.imagePrompt || '',
      audioUrl: null,
      choices,
      allowCustomInput: !proposal.isEnding,
      depth: expansion.depth,
      voiceSegments: [],
      frames: [],
      metadata: { tags: [], storyContext: '' },
    },
  };

  addNode(newNode);

  // Create edge from parent (skip for root)
  if (!isRoot) {
    addEdge({
      id: `edge_${uuid().slice(0, 8)}`,
      source: expansion.parentNodeId,
      target: nodeId,
      sourceHandle: expansion.choiceId,
      label: expansion.choiceText,
      type: 'authored',
    });
    updateChoice(expansion.parentNodeId, expansion.choiceId, { targetNodeId: nodeId });
  }

  // Update pending expansions (DFS: insert in reverse so first choice is at front)
  removePendingExpansion(expansion.parentNodeId, expansion.choiceId);
  for (let i = choices.length - 1; i >= 0; i--) {
    addPendingExpansion({
      parentNodeId: nodeId,
      choiceId: choices[i].id,
      choiceText: choices[i].text,
      depth: expansion.depth + 1,
    });
  }

  setInteractiveBranch({
    completedNodeIds: [...ib.completedNodeIds, nodeId],
  });

  return nodeId;
}

/** Helper: format interactive branch progress */
function formatIBProgress(): string {
  const ib = useChatStore.getState().orchestrator.interactiveBranch;
  const story = useStoryStore.getState().story;
  const nodes = (story?.nodes || []).filter(n => n.type !== 'story_config');
  const endings = nodes.filter(n => n.type === 'ending').length;
  const pending = ib.pendingExpansions;

  let status = `📊 进度: ${nodes.length}个节点 | ${endings}个结局 | 待展开${pending.length}条分支 | 深度上限${ib.maxDepth}层`;
  if (pending.length > 0) {
    status += '\n\n🌿 待展开分支:';
    for (const p of pending.slice(0, 5)) {
      const pNode = story?.nodes.find(n => n.id === p.parentNodeId);
      status += `\n  - "${p.choiceText}" ← 来自「${pNode?.data.title || p.parentNodeId}」(depth ${p.depth})`;
    }
    if (pending.length > 5) status += `\n  ...还有${pending.length - 5}条`;
  }
  return status;
}

/**
 * expand_node: Generate 2-3 proposals for the next pending branch.
 * If no interactive state exists, initializes it (like opening node).
 */
const expandNode: ToolExecutor = async (_input, ctx) => {
  const outline = useChatStore.getState().orchestrator.outline;
  if (!outline) return { tool: 'expand_node', success: false, result: '请先生成大纲（generate_outline）' };

  const { setInteractiveBranch } = useChatStore.getState();
  let ib = useChatStore.getState().orchestrator.interactiveBranch;

  // Initialize if not active
  if (!ib.active) {
    const maxDepth = outline.depth || 10;
    setInteractiveBranch({
      active: true,
      proposals: [],
      pendingExpansions: [],
      completedNodeIds: [],
      currentExpansion: null,
      maxDepth,
      phase: 'generating',
    });

    // Create story config node
    const story = useStoryStore.getState().story;
    if (story) {
      const configNode: StoryNode = {
        id: 'story-config',
        type: 'story_config' as const,
        position: { x: 0, y: -120 },
        data: {
          title: story.title || '故事配置',
          narration: '', dialogue: null, character: null,
          imageUrl: null, imagePrompt: '', audioUrl: null,
          choices: [], allowCustomInput: false, depth: -1,
          voiceSegments: [], frames: [],
          metadata: { tags: [], storyContext: '' },
        },
      };
      useStoryStore.getState().setNodesAndEdges([configNode], []);
    }

    // Generate opening proposals
    const rootExpansion: PendingExpansion = {
      parentNodeId: '__root__',
      choiceId: '__start__',
      choiceText: '故事开场',
      depth: 0,
    };

    ctx.updateMessage('🤝 共创模式启动！正在生成开场方案...');
    const proposals = await callExpandNodeAPI(rootExpansion, ctx.signal);
    setInteractiveBranch({ phase: 'waiting_creator', proposals, currentExpansion: rootExpansion });

    // Show proposals directly to user via message update
    let displayText = `🤝 **共创模式启动！** 深度上限 ${maxDepth} 层\n\n**开场方案：**\n\n`;
    proposals.forEach((p, i) => {
      displayText += `**${i + 1}. 「${p.title}」** - ${p.narrationPreview}\n   → _${p.direction}_${p.isEnding ? ' [结局]' : ''}\n\n`;
    });
    displayText += `输入 **数字** 选择方案，或直接写你想要的开场内容。`;
    ctx.updateMessage(displayText);

    // Return observation — loop will pause via PAUSE_FOR_USER mechanism
    const shortResult = `共创模式已启动，${proposals.length}个开场方案已展示给用户。方案：${proposals.map((p, i) => `${i + 1}.${p.title}`).join('、')}。等待用户选择后调用 apply_proposal。`;

    return { tool: 'expand_node', success: true, result: shortResult, data: { proposals, _pauseForUser: true } };
  }

  // Already active: expand next pending branch
  ib = useChatStore.getState().orchestrator.interactiveBranch;
  if (ib.pendingExpansions.length === 0) {
    setInteractiveBranch({ phase: 'idle', active: false });
    return {
      tool: 'expand_node', success: true,
      result: `🎉 所有分支已展开完成！\n\n${formatIBProgress()}\n\n可以继续下一步（extract_entities）。`,
    };
  }

  const next = ib.pendingExpansions[0];
  setInteractiveBranch({ phase: 'generating', currentExpansion: next });
  ctx.updateMessage(`⏳ 正在为 "${next.choiceText}" 生成方案...`);

  const proposals = await callExpandNodeAPI(next, ctx.signal);
  setInteractiveBranch({ phase: 'waiting_creator', proposals });

  const parentNode = useStoryStore.getState().story?.nodes.find(n => n.id === next.parentNodeId);

  // Show proposals directly to user
  let displayText = `${formatIBProgress()}\n\n---\n\n🔀 **"${next.choiceText}"** ← 来自「${parentNode?.data.title || ''}」\n\n`;
  proposals.forEach((p, i) => {
    displayText += `**${i + 1}. 「${p.title}」** - ${p.narrationPreview}\n   → _${p.direction}_${p.isEnding ? ' [结局]' : ''}\n\n`;
  });
  displayText += `输入 **数字** 选择，或输入 "跳过" / "自动完成"。`;
  ctx.updateMessage(displayText);

  // Short observation for LLM — loop will pause via PAUSE_FOR_USER mechanism
  const shortResult = `已为"${next.choiceText}"生成${proposals.length}个方案并展示给用户。方案：${proposals.map((p, i) => `${i + 1}.${p.title}${p.isEnding ? '(结局)' : ''}`).join('、')}。等待用户选择后调用 apply_proposal。`;

  return { tool: 'expand_node', success: true, result: shortResult, data: { proposals, _pauseForUser: true } };
};

/**
 * apply_proposal: Apply the user's chosen proposal (by index 1/2/3).
 * Also supports "skip" (mark as ending) and "ending" (force ending).
 */
const applyProposalTool: ToolExecutor = async (input, ctx) => {
  const ib = useChatStore.getState().orchestrator.interactiveBranch;
  if (!ib.active) return { tool: 'apply_proposal', success: false, result: '共创模式未启动，请先调用 expand_node' };

  const expansion = ib.currentExpansion;
  if (!expansion) return { tool: 'apply_proposal', success: false, result: '没有当前待展开的节点' };

  const choice = input.choice as string | number;
  const proposals = ib.proposals;

  // Handle "skip" — mark branch as ended
  if (choice === 'skip' || choice === '跳过') {
    useChatStore.getState().removePendingExpansion(expansion.parentNodeId, expansion.choiceId);
    return {
      tool: 'apply_proposal', success: true,
      result: `已跳过分支 "${expansion.choiceText}"。\n\n${formatIBProgress()}\n\n继续调用 expand_node 展开下一个分支。`,
    };
  }

  // Handle numeric choice (1/2/3)
  const idx = typeof choice === 'number' ? choice - 1 : parseInt(String(choice), 10) - 1;
  if (idx >= 0 && idx < proposals.length) {
    const proposal = proposals[idx];
    const nodeId = applyProposalToStory(proposal, expansion);
    const node = useStoryStore.getState().story?.nodes.find(n => n.id === nodeId);

    return {
      tool: 'apply_proposal', success: true,
      result: `✅ 已创建节点「${proposal.title}」(${proposal.isEnding ? '结局' : '剧情'}, depth ${expansion.depth})\n\n${formatIBProgress()}\n\n继续调用 expand_node 展开下一个分支。`,
    };
  }

  return { tool: 'apply_proposal', success: false, result: `无效选择: ${choice}。可选 1-${proposals.length} 或 "skip"` };
};

/**
 * auto_complete_branches: Automatically complete all remaining pending expansions.
 * AI picks the best proposal for each (prefers endings when deep enough).
 */
const autoCompleteBranches: ToolExecutor = async (_input, ctx) => {
  const ib = useChatStore.getState().orchestrator.interactiveBranch;
  if (!ib.active) return { tool: 'auto_complete_branches', success: false, result: '共创模式未启动' };

  const { setInteractiveBranch, removePendingExpansion } = useChatStore.getState();
  setInteractiveBranch({ phase: 'auto_completing' });

  let completed = 0;
  let maxIterations = 50; // safety limit

  while (maxIterations-- > 0) {
    if (ctx.signal.aborted) throw new Error('已取消');
    const currentIb = useChatStore.getState().orchestrator.interactiveBranch;
    if (currentIb.pendingExpansions.length === 0) break;

    const next = currentIb.pendingExpansions[0];
    ctx.updateMessage(`⚡ 自动生成中... (${completed} 完成, ${currentIb.pendingExpansions.length} 剩余)`);

    try {
      const proposals = await callExpandNodeAPI(next, ctx.signal);
      if (proposals.length === 0) {
        removePendingExpansion(next.parentNodeId, next.choiceId);
        continue;
      }

      // Pick: prefer ending if depth >= 70% maxDepth, else pick first
      const depthPct = currentIb.maxDepth > 0 ? next.depth / currentIb.maxDepth : 0;
      const pick = depthPct >= 0.7
        ? (proposals.find(p => p.isEnding) || proposals[0])
        : proposals[0];

      applyProposalToStory(pick, next);
      completed++;
    } catch (err: any) {
      // Skip failed expansion
      removePendingExpansion(next.parentNodeId, next.choiceId);
    }
  }

  setInteractiveBranch({ phase: 'idle', active: false });

  return {
    tool: 'auto_complete_branches', success: true,
    result: `⚡ 自动完成！新增 ${completed} 个节点。\n\n${formatIBProgress()}\n\n可以继续下一步（extract_entities）。`,
  };
};

const extractEntities: ToolExecutor = async (_input, ctx) => {
  const story = useStoryStore.getState().story;
  const style = useChatStore.getState().orchestrator.style;
  if (!story || story.nodes.length === 0) return { tool: 'extract_entities', success: false, result: '没有剧情节点，请先生成分支' };

  ctx.updateMessage('👤 正在提取角色、场景、道具...');
  const entities = await callSkillAPI('entityExtractor', {
    nodes: story.nodes,
    style,
  }, ctx.signal);

  useChatStore.getState().setEntities(entities);

  return {
    tool: 'extract_entities', success: true,
    result: `主体提取完成：${entities.characters?.length || 0}个角色，${entities.scenes?.length || 0}个场景，${entities.props?.length || 0}个道具`,
    data: entities,
  };
};

const generateEntityImages: ToolExecutor = async (_input, ctx) => {
  const entities = useChatStore.getState().orchestrator.entities;
  const style = useChatStore.getState().orchestrator.style;
  if (!entities) return { tool: 'generate_entity_images', success: false, result: '请先提取主体（extract_entities）' };

  const stylePrefix = style?.stylePromptPrefix || '';
  const { updateEntityImage } = useChatStore.getState();

  // Collect tasks
  const tasks: { type: 'characters' | 'scenes' | 'props'; id: string; name: string; prompt: string; aspectRatio: string }[] = [];
  for (const c of (entities.characters || [])) {
    if (c.imagePrompt) tasks.push({ type: 'characters', id: c.id, name: c.name, prompt: `${stylePrefix}${c.imagePrompt}`, aspectRatio: '3:4' });
  }
  for (const s of (entities.scenes || [])) {
    if (s.imagePrompt) tasks.push({ type: 'scenes', id: s.id, name: s.name, prompt: `${stylePrefix}${s.imagePrompt}`, aspectRatio: '16:9' });
  }
  for (const p of (entities.props || [])) {
    if (p.imagePrompt) tasks.push({ type: 'props', id: p.id, name: p.name, prompt: `${stylePrefix}${p.imagePrompt}`, aspectRatio: '1:1' });
  }

  if (tasks.length === 0) return { tool: 'generate_entity_images', success: true, result: '没有需要生成图片的主体' };

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < tasks.length; i += 3) {
    if (ctx.signal.aborted) throw new Error('已取消');
    const batch = tasks.slice(i, i + 3);
    ctx.updateMessage(`🖼️ 生成参考图 ${completed}/${tasks.length}...`);

    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: task.prompt, aspectRatio: task.aspectRatio }),
          signal: ctx.signal,
        });
        const data = await res.json();
        if (!data.success || !data.taskId) throw new Error(data.error || 'Submit failed');

        // Progressive backoff polling (2s → 5s, max 15 attempts)
        let delay = 2000;
        for (let attempt = 0; attempt < 15; attempt++) {
          if (ctx.signal.aborted) throw new Error('已取消');
          await new Promise((r) => setTimeout(r, delay));
          const poll = await fetch(`/api/generate-image?taskId=${data.taskId}`, { signal: ctx.signal });
          const pollData = await poll.json();
          if (pollData.status === 'completed' && pollData.imageUrl) return { ...task, imageUrl: pollData.imageUrl };
          if (pollData.status === 'failed') throw new Error('Generation failed');
          delay = Math.min(delay * 1.3, 5000);
        }
        throw new Error('Timeout');
      }),
    );

    for (const r of results) {
      completed++;
      if (r.status === 'fulfilled') {
        updateEntityImage(r.value.type, r.value.id, r.value.imageUrl);
      } else {
        failed++;
      }
    }
  }

  return {
    tool: 'generate_entity_images', success: true,
    result: `参考图生成完成：${completed - failed}/${tasks.length} 成功${failed > 0 ? `，${failed} 个失败` : ''}`,
  };
};

const generateStoryboard: ToolExecutor = async (_input, ctx) => {
  const style = useChatStore.getState().orchestrator.style;
  const entities = useChatStore.getState().orchestrator.entities;
  const story = useStoryStore.getState().story;
  if (!story || !entities) return { tool: 'generate_storyboard', success: false, result: '缺少剧情节点或主体数据' };

  const { updateNode } = useStoryStore.getState();
  const nodes = story.nodes.filter((n) => n.type !== 'story_config');
  let success = 0;

  for (let i = 0; i < nodes.length; i += 3) {
    if (ctx.signal.aborted) throw new Error('已取消');
    const batch = nodes.slice(i, i + 3);
    ctx.updateMessage(`🎬 生成分镜 ${success}/${nodes.length}...`);

    const results = await Promise.allSettled(
      batch.map((node) =>
        callSkillAPI('storyboardGenerator', {
          node: { id: node.id, data: node.data },
          entities,
          style,
        }, ctx.signal),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        const sb = (results[j] as PromiseFulfilledResult<any>).value;
        const frames = (sb.frames || []).map((f: any) => ({
          id: crypto.randomUUID(),
          narrationSegment: f.narrationSegment || '',
          imagePrompt: f.imagePrompt || '',
          imageUrl: null,
          entityRefs: f.entityRefs || [],
          duration: f.duration || 3,
        }));
        updateNode(batch[j].id, {
          imagePrompt: sb.imagePrompt || frames[0]?.imagePrompt || '',
          narration: sb.narration || batch[j].data.narration,
          frames,
        });
        success++;
      }
    }
  }

  // Generate first-frame images for each node (batch 3, with entity refs)
  ctx.updateMessage(`🎨 生成分镜图片 0/${success}...`);
  const storyAfterSb = useStoryStore.getState().story;
  const sbNodes = storyAfterSb?.nodes.filter((n) => n.type !== 'story_config' && n.data.frames?.length > 0) || [];
  let imgSuccess = 0;

  for (let i = 0; i < sbNodes.length; i += 3) {
    if (ctx.signal.aborted) break;
    const batch = sbNodes.slice(i, i + 3);
    await Promise.allSettled(
      batch.map(async (node) => {
        const frame = node.data.frames[0];
        if (!frame?.imagePrompt) return;
        try {
          const imageList = getEntityImageList(entities, frame.entityRefs, node.data.character);
          const taskId = await submitImageGeneration({
            prompt: frame.imagePrompt,
            aspect_ratio: '16:9',
            image_list: imageList.length > 0 ? imageList : undefined,
          });
          const result = await pollImageResult(taskId);
          if (result.status === 'completed' && result.imageUrl) {
            const updatedFrames = [...node.data.frames];
            updatedFrames[0] = { ...updatedFrames[0], imageUrl: result.imageUrl };
            updateNode(node.id, { imageUrl: result.imageUrl, frames: updatedFrames });
            imgSuccess++;
          }
        } catch { /* skip failed */ }
      }),
    );
    ctx.updateMessage(`🎨 生成分镜图片 ${imgSuccess}/${sbNodes.length}...`);
  }

  return {
    tool: 'generate_storyboard', success: true,
    result: `分镜生成完成：${success}/${nodes.length} 个节点，${imgSuccess} 张图片`,
  };
};

const generateVoice: ToolExecutor = async (_input, ctx) => {
  const entities = useChatStore.getState().orchestrator.entities;
  const story = useStoryStore.getState().story;
  if (!story || !entities) return { tool: 'generate_voice', success: false, result: '缺少剧情节点或主体数据' };

  const { updateNode } = useStoryStore.getState();
  const nodes = story.nodes.filter((n) => n.type !== 'story_config');
  let segmentCount = 0;
  let audioCount = 0;

  // Phase 1: Voice segmentation
  ctx.updateMessage('🎙️ 正在为每个节点生成配音分段...');
  for (let i = 0; i < nodes.length; i += 3) {
    if (ctx.signal.aborted) throw new Error('已取消');
    const batch = nodes.slice(i, i + 3);

    const results = await Promise.allSettled(
      batch.map((node) =>
        callSkillAPI('voiceGenerator', {
          storyboard: { nodeId: node.id, frames: node.data.frames || [] },
          entities,
        }, ctx.signal),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        const voice = (results[j] as PromiseFulfilledResult<any>).value;
        const defaultVoice = useStoryStore.getState().story?.settings?.defaultVoice || 'narrator';
        const segments = (voice.voiceSegments || voice.segments || []).map((s: any) => ({
          text: s.text,
          voiceType: (s.speaker === 'narrator' || s.voiceType === 'narrator') ? defaultVoice : (s.voiceType || 'narrator'),
          speaker: s.speaker || 'narrator',
          speed: s.speed || 1,
          audioUrl: null,
        }));
        updateNode(batch[j].id, { voiceSegments: segments });
        // Sync voice text back to frames
        const currentFrames = batch[j].data.frames || [];
        if (currentFrames.length > 0) {
          updateNode(batch[j].id, { frames: syncFramesFromVoice(currentFrames, segments) });
        }
        segmentCount += segments.length;
      }
    }
  }

  // Phase 2: TTS generation
  ctx.updateMessage(`🔊 正在生成 TTS 音频 (${segmentCount} 段)...`);
  const updatedStory = useStoryStore.getState().story!;
  for (const node of updatedStory.nodes.filter((n) => n.type !== 'story_config')) {
    if (ctx.signal.aborted) throw new Error('已取消');
    const segments = node.data.voiceSegments || [];
    let updated = false;

    for (let s = 0; s < segments.length; s++) {
      if (segments[s].audioUrl) { audioCount++; continue; }
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: segments[s].text,
            voiceType: segments[s].voiceType,
            speed: segments[s].speed,
          }),
          signal: ctx.signal,
        });
        const data = await res.json();
        if (data.audioUrl) {
          segments[s] = { ...segments[s], audioUrl: data.audioUrl };
          audioCount++;
          updated = true;
        }
      } catch { /* skip failed TTS */ }
    }

    if (updated) {
      updateNode(node.id, { voiceSegments: [...segments] });
    }
  }

  return {
    tool: 'generate_voice', success: true,
    result: `配音生成完成：${segmentCount} 个分段，${audioCount} 个音频`,
  };
};

const editNode: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'edit_node', success: false, result: '没有故事数据' };

  const nodeIndex = input.nodeIndex as number;
  const field = input.field as string;
  const newValue = input.newValue as string;
  const validFields = ['narration', 'title', 'dialogue', 'character', 'imagePrompt', 'allowCustomInput'];

  if (!validFields.includes(field)) {
    return { tool: 'edit_node', success: false, result: `无效字段 "${field}"，可选：${validFields.join(', ')}` };
  }

  const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
  if (nodeIndex < 0 || nodeIndex >= targetNodes.length) {
    return { tool: 'edit_node', success: false, result: `节点序号 ${nodeIndex} 超出范围 (0-${targetNodes.length - 1})` };
  }

  const node = targetNodes[nodeIndex];
  useStoryStore.getState().updateNode(node.id, { [field]: newValue });

  return {
    tool: 'edit_node', success: true,
    result: `已修改节点 "${node.data.title}" 的 ${field}`,
  };
};

const getState: ToolExecutor = async () => {
  const { orchestrator } = useChatStore.getState();
  const story = useStoryStore.getState().story;

  const parts: string[] = [];
  parts.push(`故事描述: ${orchestrator.storyDescription || '(未设置)'}`);
  parts.push(`风格: ${orchestrator.style?.styleName || '(未选择)'}`);
  parts.push(`大纲: ${orchestrator.outline ? `${orchestrator.outline.theme}, ${orchestrator.outline.depth}层` : '(未生成)'}`);
  parts.push(`节点数: ${story?.nodes.filter((n) => n.type !== 'story_config').length || 0}`);
  parts.push(`主体: ${orchestrator.entities ? `${orchestrator.entities.characters?.length || 0}角色, ${orchestrator.entities.scenes?.length || 0}场景` : '(未提取)'}`);

  const nodesWithFrames = story?.nodes.filter((n) => n.data.frames && n.data.frames.length > 0).length || 0;
  const nodesWithVoice = story?.nodes.filter((n) => n.data.voiceSegments && n.data.voiceSegments.length > 0).length || 0;
  parts.push(`已分镜: ${nodesWithFrames} 个节点`);
  parts.push(`已配音: ${nodesWithVoice} 个节点`);

  return {
    tool: 'get_state', success: true,
    result: parts.join('\n'),
  };
};

const askUser: ToolExecutor = async (input, ctx) => {
  const message = (input.message as string) || '请确认是否继续';
  ctx.addMessage({ role: 'assistant', content: message });

  return {
    tool: 'ask_user', success: true,
    result: '[等待用户回复]',
  };
};

// ============================================================
// CRUD Helpers
// ============================================================

function resolveNode(
  story: Story,
  input: Record<string, unknown>,
  indexKey = 'nodeIndex',
): { node: StoryNode; index: number; targetNodes: StoryNode[] } | null {
  const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
  const idx = input[indexKey] as number;
  if (typeof idx !== 'number' || idx < 0 || idx >= targetNodes.length) return null;
  return { node: targetNodes[idx], index: idx, targetNodes };
}

function nodeIndexError(story: Story, indexKey: string, val: unknown): string {
  const count = story.nodes.filter((n) => n.type !== 'story_config').length;
  return `${indexKey}=${val} 超出范围 (0-${count - 1})`;
}

function formatNodeList(story: Story): string {
  const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
  const typeIcons: Record<string, string> = { start: '🟢', scene: '📖', ending: '🔴', ai_generated: '🤖' };
  return targetNodes
    .map((n, i) => {
      const icon = typeIcons[n.type] || '📄';
      const choiceCount = n.data.choices?.length || 0;
      const frameCount = n.data.frames?.length || 0;
      // Find outgoing edges
      const outEdges = story.edges.filter((e) => e.source === n.id);
      const connections = outEdges
        .map((e) => {
          const ti = targetNodes.findIndex((t) => t.id === e.target);
          return ti >= 0 ? ti : '?';
        })
        .join(',');
      return `[${i}] ${icon} ${n.type} - "${n.data.title || '无标题'}" (${choiceCount}选项, ${frameCount}帧${connections ? `, →${connections}` : ''})`;
    })
    .join('\n');
}

// ============================================================
// CRUD Tool Executors
// ============================================================

const manageNode: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'manage_node', success: false, result: '没有故事数据' };
  const action = input.action as string;

  if (action === 'add') {
    const nodeType = (input.type as string) || 'scene';
    const title = (input.title as string) || '新节点';
    const narration = (input.narration as string) || '';
    const afterIdx = input.afterNodeIndex as number | undefined;

    // Calculate position
    const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
    let x = 300, y = 200;
    if (typeof afterIdx === 'number' && afterIdx >= 0 && afterIdx < targetNodes.length) {
      const afterNode = targetNodes[afterIdx];
      x = afterNode.position.x + 300;
      y = afterNode.position.y;
    } else if (targetNodes.length > 0) {
      const maxX = Math.max(...targetNodes.map((n) => n.position.x));
      x = maxX + 300;
    }

    const newId = crypto.randomUUID();
    const newNode: StoryNode = {
      id: newId,
      type: nodeType as StoryNode['type'],
      position: { x, y },
      data: {
        title,
        narration,
        dialogue: null,
        character: null,
        imageUrl: null,
        imagePrompt: '',
        audioUrl: null,
        choices: [],
        allowCustomInput: false,
        depth: 0,
        voiceSegments: [],
        frames: [],
        metadata: { tags: [], storyContext: '' },
      },
    };
    useStoryStore.getState().addNode(newNode);

    // Auto-connect from afterNode
    if (typeof afterIdx === 'number' && afterIdx >= 0 && afterIdx < targetNodes.length) {
      const sourceNode = targetNodes[afterIdx];
      useStoryStore.getState().addEdge({
        id: crypto.randomUUID(),
        source: sourceNode.id,
        target: newId,
        sourceHandle: 'default',
        label: '',
        type: 'authored',
      });
    }

    const newIndex = story.nodes.filter((n) => n.type !== 'story_config').length; // will be at the end
    return {
      tool: 'manage_node', success: true,
      result: `已添加节点 [${newIndex}] "${title}" (${nodeType})${typeof afterIdx === 'number' ? `，已连接从节点 [${afterIdx}]` : ''}`,
    };
  }

  if (action === 'remove') {
    const resolved = resolveNode(story, input);
    if (!resolved) return { tool: 'manage_node', success: false, result: nodeIndexError(story, 'nodeIndex', input.nodeIndex) };
    const { node } = resolved;
    const title = node.data.title;
    useStoryStore.getState().removeNode(node.id);
    return { tool: 'manage_node', success: true, result: `已删除节点 "${title}" 及其关联连线` };
  }

  if (action === 'move') {
    const resolved = resolveNode(story, input);
    if (!resolved) return { tool: 'manage_node', success: false, result: nodeIndexError(story, 'nodeIndex', input.nodeIndex) };
    const x = input.x as number;
    const y = input.y as number;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return { tool: 'manage_node', success: false, result: '需要提供 x 和 y 坐标' };
    }
    useStoryStore.getState().updateNodePosition(resolved.node.id, { x, y });
    return { tool: 'manage_node', success: true, result: `已移动节点 "${resolved.node.data.title}" 到 (${x}, ${y})` };
  }

  return { tool: 'manage_node', success: false, result: `未知操作 "${action}"，可选: add, remove, move` };
};

const manageEdge: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'manage_edge', success: false, result: '没有故事数据' };
  const action = input.action as string;

  if (action === 'list') {
    if (story.edges.length === 0) return { tool: 'manage_edge', success: true, result: '当前没有连线' };
    const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
    const lines = story.edges.map((e) => {
      const si = targetNodes.findIndex((n) => n.id === e.source);
      const ti = targetNodes.findIndex((n) => n.id === e.target);
      const sName = si >= 0 ? `[${si}] ${targetNodes[si].data.title}` : e.source;
      const tName = ti >= 0 ? `[${ti}] ${targetNodes[ti].data.title}` : e.target;
      return `${sName} → ${tName}${e.label ? ` [${e.label}]` : ''}`;
    });
    return { tool: 'manage_edge', success: true, result: `共 ${story.edges.length} 条连线：\n${lines.join('\n')}` };
  }

  if (action === 'add') {
    const sourceResolved = resolveNode(story, input, 'sourceNodeIndex');
    if (!sourceResolved) return { tool: 'manage_edge', success: false, result: nodeIndexError(story, 'sourceNodeIndex', input.sourceNodeIndex) };
    const targetResolved = resolveNode(story, input, 'targetNodeIndex');
    if (!targetResolved) return { tool: 'manage_edge', success: false, result: nodeIndexError(story, 'targetNodeIndex', input.targetNodeIndex) };

    const label = (input.label as string) || '';
    useStoryStore.getState().addEdge({
      id: crypto.randomUUID(),
      source: sourceResolved.node.id,
      target: targetResolved.node.id,
      sourceHandle: 'default',
      label,
      type: 'authored',
    });
    return {
      tool: 'manage_edge', success: true,
      result: `已添加连线：[${input.sourceNodeIndex}] "${sourceResolved.node.data.title}" → [${input.targetNodeIndex}] "${targetResolved.node.data.title}"`,
    };
  }

  if (action === 'remove') {
    const sourceResolved = resolveNode(story, input, 'sourceNodeIndex');
    if (!sourceResolved) return { tool: 'manage_edge', success: false, result: nodeIndexError(story, 'sourceNodeIndex', input.sourceNodeIndex) };
    const targetResolved = resolveNode(story, input, 'targetNodeIndex');
    if (!targetResolved) return { tool: 'manage_edge', success: false, result: nodeIndexError(story, 'targetNodeIndex', input.targetNodeIndex) };

    const edge = story.edges.find(
      (e) => e.source === sourceResolved.node.id && e.target === targetResolved.node.id,
    );
    if (!edge) return { tool: 'manage_edge', success: false, result: '未找到该连线' };

    useStoryStore.getState().removeEdge(edge.id);
    return {
      tool: 'manage_edge', success: true,
      result: `已删除连线：[${input.sourceNodeIndex}] → [${input.targetNodeIndex}]`,
    };
  }

  return { tool: 'manage_edge', success: false, result: `未知操作 "${action}"，可选: add, remove, list` };
};

const manageChoice: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'manage_choice', success: false, result: '没有故事数据' };
  const action = input.action as string;

  const resolved = resolveNode(story, input);
  if (!resolved) return { tool: 'manage_choice', success: false, result: nodeIndexError(story, 'nodeIndex', input.nodeIndex) };
  const { node } = resolved;

  if (action === 'add') {
    const text = input.text as string;
    if (!text) return { tool: 'manage_choice', success: false, result: '需要提供选项文字 (text)' };

    let targetNodeId: string | undefined;
    if (typeof input.targetNodeIndex === 'number') {
      const targetResolved = resolveNode(story, input, 'targetNodeIndex');
      if (!targetResolved) return { tool: 'manage_choice', success: false, result: nodeIndexError(story, 'targetNodeIndex', input.targetNodeIndex) };
      targetNodeId = targetResolved.node.id;
    }

    const choiceId = crypto.randomUUID();
    useStoryStore.getState().addChoice(node.id, { id: choiceId, text, targetNodeId: targetNodeId || '' });
    return { tool: 'manage_choice', success: true, result: `已为节点 "${node.data.title}" 添加选项 "${text}"` };
  }

  if (action === 'update') {
    const choiceIdx = input.choiceIndex as number;
    const choices = node.data.choices || [];
    if (typeof choiceIdx !== 'number' || choiceIdx < 0 || choiceIdx >= choices.length) {
      return { tool: 'manage_choice', success: false, result: `choiceIndex=${choiceIdx} 超出范围 (0-${choices.length - 1})` };
    }
    const choice = choices[choiceIdx];
    const updates: Record<string, unknown> = {};
    if (input.text) updates.text = input.text;
    if (typeof input.targetNodeIndex === 'number') {
      const targetResolved = resolveNode(story, input, 'targetNodeIndex');
      if (!targetResolved) return { tool: 'manage_choice', success: false, result: nodeIndexError(story, 'targetNodeIndex', input.targetNodeIndex) };
      updates.targetNodeId = targetResolved.node.id;
    }
    useStoryStore.getState().updateChoice(node.id, choice.id, updates);
    return { tool: 'manage_choice', success: true, result: `已更新节点 "${node.data.title}" 的选项 [${choiceIdx}]` };
  }

  if (action === 'remove') {
    const choiceIdx = input.choiceIndex as number;
    const choices = node.data.choices || [];
    if (typeof choiceIdx !== 'number' || choiceIdx < 0 || choiceIdx >= choices.length) {
      return { tool: 'manage_choice', success: false, result: `choiceIndex=${choiceIdx} 超出范围 (0-${choices.length - 1})` };
    }
    const choice = choices[choiceIdx];

    // Also remove associated edge if targetNodeId exists
    if (choice.targetNodeId) {
      const edge = story.edges.find(
        (e) => e.source === node.id && e.target === choice.targetNodeId,
      );
      if (edge) useStoryStore.getState().removeEdge(edge.id);
    }

    useStoryStore.getState().removeChoice(node.id, choice.id);
    return { tool: 'manage_choice', success: true, result: `已删除节点 "${node.data.title}" 的选项 "${choice.text}"` };
  }

  return { tool: 'manage_choice', success: false, result: `未知操作 "${action}"，可选: add, update, remove` };
};

const manageFrame: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'manage_frame', success: false, result: '没有故事数据' };
  const action = input.action as string;

  const resolved = resolveNode(story, input);
  if (!resolved) return { tool: 'manage_frame', success: false, result: nodeIndexError(story, 'nodeIndex', input.nodeIndex) };
  const { node } = resolved;

  if (action === 'add') {
    const narrationSegment = (input.narrationSegment as string) || '';
    const imagePrompt = (input.imagePrompt as string) || '';
    const duration = (input.duration as number) || 3;

    const frame = {
      id: crypto.randomUUID(),
      narrationSegment,
      imagePrompt,
      imageUrl: null as string | null,
      entityRefs: [] as string[],
      duration,
    };
    useStoryStore.getState().addFrame(node.id, frame);
    return { tool: 'manage_frame', success: true, result: `已为节点 "${node.data.title}" 添加画面帧` };
  }

  if (action === 'update') {
    const frameIdx = input.frameIndex as number;
    const frames = node.data.frames || [];
    if (typeof frameIdx !== 'number' || frameIdx < 0 || frameIdx >= frames.length) {
      return { tool: 'manage_frame', success: false, result: `frameIndex=${frameIdx} 超出范围 (0-${frames.length - 1})` };
    }
    const frame = frames[frameIdx];
    const updates: Record<string, unknown> = {};
    if (input.narrationSegment !== undefined) updates.narrationSegment = input.narrationSegment;
    if (input.imagePrompt !== undefined) updates.imagePrompt = input.imagePrompt;
    if (input.duration !== undefined) updates.duration = input.duration;

    useStoryStore.getState().updateFrame(node.id, frame.id, updates);
    return { tool: 'manage_frame', success: true, result: `已更新节点 "${node.data.title}" 的画面帧 [${frameIdx}]` };
  }

  if (action === 'remove') {
    const frameIdx = input.frameIndex as number;
    const frames = node.data.frames || [];
    if (typeof frameIdx !== 'number' || frameIdx < 0 || frameIdx >= frames.length) {
      return { tool: 'manage_frame', success: false, result: `frameIndex=${frameIdx} 超出范围 (0-${frames.length - 1})` };
    }
    useStoryStore.getState().removeFrame(node.id, frames[frameIdx].id);
    return { tool: 'manage_frame', success: true, result: `已删除节点 "${node.data.title}" 的画面帧 [${frameIdx}]` };
  }

  return { tool: 'manage_frame', success: false, result: `未知操作 "${action}"，可选: add, update, remove` };
};

const listNodes: ToolExecutor = async (input) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'list_nodes', success: false, result: '没有故事数据' };

  const targetNodes = story.nodes.filter((n) => n.type !== 'story_config');
  if (targetNodes.length === 0) return { tool: 'list_nodes', success: true, result: '当前没有剧情节点' };

  const verbose = input.verbose as boolean;
  let result = `共 ${targetNodes.length} 个节点：\n${formatNodeList(story)}`;

  if (verbose) {
    result += `\n\n共 ${story.edges.length} 条连线`;
    const endings = targetNodes.filter((n) => n.type === 'ending').length;
    result += `\n结局节点: ${endings} 个`;
  }

  return { tool: 'list_nodes', success: true, result };
};

const resetStory: ToolExecutor = async (_input, ctx) => {
  const story = useStoryStore.getState().story;
  if (!story) return { tool: 'reset_story', success: false, result: '没有故事数据' };

  const nodeCount = story.nodes.filter((n) => n.type !== 'story_config').length;
  useStoryStore.getState().setNodesAndEdges([], []);

  // Also reset orchestrator state so agent can re-create from scratch
  const chatStore = useChatStore.getState();
  chatStore.setOutline(null as any);
  chatStore.setEntities(null as any);
  chatStore.orchestrator.skills.forEach((s) => chatStore.updateSkillStatus(s.name, 'idle'));
  chatStore.setCurrentSkill(null);

  return {
    tool: 'reset_story', success: true,
    result: `已清空故事画布：删除了 ${nodeCount} 个节点和所有连线。可以重新开始创作。`,
  };
};

// ============================================================
// Tool Registry
// ============================================================

export const TOOL_EXECUTORS: Record<ToolName, ToolExecutor> = {
  select_style: selectStyle,
  generate_outline: generateOutline,
  generate_branches: generateBranches,
  expand_node: expandNode,
  apply_proposal: applyProposalTool,
  auto_complete_branches: autoCompleteBranches,
  extract_entities: extractEntities,
  generate_entity_images: generateEntityImages,
  generate_storyboard: generateStoryboard,
  generate_voice: generateVoice,
  edit_node: editNode,
  manage_node: manageNode,
  manage_edge: manageEdge,
  manage_choice: manageChoice,
  manage_frame: manageFrame,
  list_nodes: listNodes,
  reset_story: resetStory,
  get_state: getState,
  ask_user: askUser,
};
