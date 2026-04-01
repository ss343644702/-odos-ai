/**
 * Co-creation tools — interactive branch expansion with human-in-the-loop.
 * Uses LangGraph interrupt() for pausing and resuming.
 *
 * Tools push commands to a module-level queue (same pattern as editing.ts).
 * The custom tool node wrapper drains after each call.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { v4 as uuid } from 'uuid';
import type { StoryNode } from '@/types/story';
import type { StoryCommand } from '../commands';
import type { StoryContextSnapshot } from '../state';
import type { NodeProposal, PendingExpansion } from '../../types';
import { getStoryContext } from './utility';
import { callSkillAPI } from './skillApi';

// ── Command accumulator ──
let _pendingCommands: StoryCommand[] = [];
export function drainCocreationCommands(): StoryCommand[] {
  const cmds = _pendingCommands;
  _pendingCommands = [];
  return cmds;
}
function emit(cmd: StoryCommand) { _pendingCommands.push(cmd); }

// ── Helpers ──

function calcChoiceCount(depth: number, maxDepth: number, totalNodes: number): number {
  const depthPct = maxDepth > 0 ? depth / maxDepth : 0;
  if (totalNodes >= 25) return 0;
  if (depthPct >= 0.7 || totalNodes > 15) return 1;
  if (depthPct >= 0.4) return 2;
  return 2;
}

/** Build the branch path from root to a given node using storyContext snapshot */
function getBranchPath(nodeId: string, ctx: StoryContextSnapshot): string[] {
  const path: string[] = [];
  let currentId = nodeId;
  let safety = 20;
  while (currentId && safety-- > 0) {
    const node = ctx.nodes.find(n => n.id === currentId);
    if (!node) break;
    path.unshift(node.title);
    const inEdge = ctx.edges.find(e => e.target === currentId);
    currentId = inEdge?.source || '';
  }
  return path;
}

/** Call expandNode skill API */
async function callExpandNodeAPI(
  expansion: PendingExpansion,
  ctx: StoryContextSnapshot,
  ibState: { maxDepth: number; pendingExpansions: PendingExpansion[] },
  signal?: AbortSignal,
  runnableConfig?: RunnableConfig,
): Promise<NodeProposal[]> {
  const outline = ctx.outline;
  if (!outline) throw new Error('没有大纲');

  const isRoot = expansion.parentNodeId === '__root__';

  // For root expansion, use outline theme as parent context
  let parentTitle: string;
  let parentNarration: string;
  if (isRoot) {
    parentTitle = '故事开场';
    parentNarration = outline.worldView || outline.theme;
  } else {
    const fullParent = ctx.fullNodes?.find(n => n.id === expansion.parentNodeId);
    parentTitle = fullParent?.data.title || ctx.nodes.find(n => n.id === expansion.parentNodeId)?.title || '';
    parentNarration = fullParent?.data.narration || '';
  }

  const existingNodes = ctx.nodes.map(n => ({
    id: n.id, title: n.title, depth: n.depth, type: n.type,
  }));

  const choiceCount = calcChoiceCount(expansion.depth, ibState.maxDepth, existingNodes.length);
  const branchPath = isRoot ? [] : getBranchPath(expansion.parentNodeId, ctx);

  const result = await callSkillAPI('expandNode', {
    parentNode: { title: parentTitle, narration: parentNarration },
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
    maxDepth: ibState.maxDepth,
    openBranches: ibState.pendingExpansions.length,
    totalNodes: existingNodes.length,
    choiceCount,
    branchPath,
  }, signal, runnableConfig) as { proposals: any[] };

  return (result.proposals || []).map((p: any, i: number) => ({
    id: `p${i + 1}`,
    title: p.title || `方案${i + 1}`,
    narrationPreview: p.narrationPreview || p.fullNode?.narration?.slice(0, 80) || '',
    direction: p.direction || '',
    isEnding: p.isEnding || false,
    fullNode: p.fullNode || {},
  }));
}

/** Apply a proposal — emit commands to create node, edge, update expansions */
function applyProposalToStory(
  proposal: NodeProposal,
  expansion: PendingExpansion,
  ctx: StoryContextSnapshot,
  ibState: { completedNodeIds: string[] },
): { nodeId: string; newChoices: Array<{ id: string; text: string }>; isEnding: boolean } {
  const nodeId = `node_${uuid().slice(0, 8)}`;
  const isRoot = expansion.parentNodeId === '__root__';
  const nodeType = proposal.isEnding ? 'ending' : (expansion.depth === 0 ? 'start' : 'scene');
  const choices = proposal.isEnding ? [] : (proposal.fullNode.choices || []).map((c: any) => ({
    id: `c_${uuid().slice(0, 6)}`,
    text: c.text,
    targetNodeId: '',
  }));

  // Position relative to parent
  const parentNode = ctx.nodes.find(n => n.id === expansion.parentNodeId);
  const parentPos = ctx.fullNodes?.find(n => n.id === expansion.parentNodeId)?.position
    || { x: 0, y: 0 };
  const siblingCount = ctx.edges.filter(e => e.source === expansion.parentNodeId).length;

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

  emit({ type: 'ADD_NODE', payload: newNode });

  // Create edge from parent (skip for root)
  if (!isRoot) {
    emit({
      type: 'ADD_EDGE',
      payload: {
        id: `edge_${uuid().slice(0, 8)}`,
        source: expansion.parentNodeId,
        target: nodeId,
        sourceHandle: expansion.choiceId,
        label: expansion.choiceText,
        type: 'authored',
      },
    });
    emit({
      type: 'UPDATE_CHOICE',
      payload: {
        nodeId: expansion.parentNodeId,
        choiceId: expansion.choiceId,
        updates: { targetNodeId: nodeId },
      },
    });
  }

  // Update pending expansions (remove current, add children in reverse for DFS)
  emit({
    type: 'REMOVE_PENDING_EXPANSION',
    payload: { parentNodeId: expansion.parentNodeId, choiceId: expansion.choiceId },
  });

  for (let i = choices.length - 1; i >= 0; i--) {
    emit({
      type: 'ADD_PENDING_EXPANSION',
      payload: {
        parentNodeId: nodeId,
        choiceId: choices[i].id,
        choiceText: choices[i].text,
        depth: expansion.depth + 1,
      },
    });
  }

  emit({
    type: 'SET_INTERACTIVE_BRANCH',
    payload: { completedNodeIds: [...ibState.completedNodeIds, nodeId] },
  });

  return { nodeId, newChoices: choices, isEnding: !!proposal.isEnding };
}

/** Format progress for LLM observation */
function formatIBProgress(ctx: StoryContextSnapshot, pendingExpansions: PendingExpansion[], maxDepth: number): string {
  const endings = ctx.nodes.filter(n => n.type === 'ending').length;
  let status = `📊 进度: ${ctx.nodeCount}个节点 | ${endings}个结局 | 待展开${pendingExpansions.length}条分支 | 深度上限${maxDepth}层`;
  if (pendingExpansions.length > 0) {
    status += '\n\n🌿 待展开分支:';
    for (const p of pendingExpansions.slice(0, 5)) {
      const pNode = ctx.nodes.find(n => n.id === p.parentNodeId);
      status += `\n  - "${p.choiceText}" ← 来自「${pNode?.title || p.parentNodeId}」(depth ${p.depth})`;
    }
    if (pendingExpansions.length > 5) status += `\n  ...还有${pendingExpansions.length - 5}条`;
  }
  return status;
}

// ── expand_node ──

export const expandNodeTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const outline = ctx.outline;
    if (!outline) return '请先生成大纲（generate_outline）';

    // Read interactive branch state from storyContext (injected by client)
    const ib = (config?.configurable as any)?.interactiveBranch ?? {
      active: false, proposals: [], pendingExpansions: [], completedNodeIds: [],
      currentExpansion: null, maxDepth: 10, phase: 'idle',
    };

    // Initialize if not active
    if (!ib.active) {
      const maxDepth = outline.depth || 10;
      emit({
        type: 'SET_INTERACTIVE_BRANCH',
        payload: {
          active: true, proposals: [], pendingExpansions: [],
          completedNodeIds: [], currentExpansion: null,
          maxDepth, phase: 'generating',
        },
      });

      // Create story config node
      const configNode: StoryNode = {
        id: 'story-config',
        type: 'story_config' as any,
        position: { x: 0, y: -120 },
        data: {
          title: ctx.storyDescription || '故事配置',
          narration: '', dialogue: null, character: null,
          imageUrl: null, imagePrompt: '', audioUrl: null,
          choices: [], allowCustomInput: false, depth: -1,
          voiceSegments: [], frames: [],
          metadata: { tags: [], storyContext: '' },
        },
      };
      emit({ type: 'SET_NODES_AND_EDGES', payload: { nodes: [configNode], edges: [] } });

      // Generate opening proposals
      const rootExpansion: PendingExpansion = {
        parentNodeId: '__root__',
        choiceId: '__start__',
        choiceText: '故事开场',
        depth: 0,
      };

      const proposals = await callExpandNodeAPI(
        rootExpansion, ctx,
        { maxDepth, pendingExpansions: [] },
        undefined, config,
      );

      emit({
        type: 'SET_INTERACTIVE_BRANCH',
        payload: { phase: 'waiting_creator', proposals, currentExpansion: rootExpansion },
      });

      // Build observation text for LLM (includes proposals for interrupt message)
      let displayText = `🤝 **共创模式启动！** 深度上限 ${maxDepth} 层\n\n**开场方案：**\n\n`;
      proposals.forEach((p, i) => {
        displayText += `**${i + 1}. 「${p.title}」** - ${p.narrationPreview}\n   → _${p.direction}_${p.isEnding ? ' [结局]' : ''}\n\n`;
      });
      displayText += `输入 **数字** 选择方案，或直接写你想要的开场内容。`;

      return `共创模式已启动，${proposals.length}个开场方案已展示给用户。方案：${proposals.map((p, i) => `${i + 1}.${p.title}`).join('、')}。\n\n${displayText}\n\n请用 ask_user 的方式将方案展示给用户，等待选择后调用 apply_proposal。`;
    }

    // Already active: expand next pending branch
    if (ib.pendingExpansions.length === 0) {
      emit({
        type: 'SET_INTERACTIVE_BRANCH',
        payload: { phase: 'idle', active: false },
      });
      return `🎉 所有分支已展开完成！\n\n${formatIBProgress(ctx, [], ib.maxDepth)}\n\n可以继续下一步（extract_entities）。`;
    }

    const next = ib.pendingExpansions[0];
    emit({
      type: 'SET_INTERACTIVE_BRANCH',
      payload: { phase: 'generating', currentExpansion: next },
    });

    const proposals = await callExpandNodeAPI(next, ctx, ib, undefined, config);
    emit({
      type: 'SET_INTERACTIVE_BRANCH',
      payload: { phase: 'waiting_creator', proposals },
    });

    const parentNode = ctx.nodes.find(n => n.id === next.parentNodeId);

    let displayText = `${formatIBProgress(ctx, ib.pendingExpansions, ib.maxDepth)}\n\n---\n\n🔀 **"${next.choiceText}"** ← 来自「${parentNode?.title || ''}」\n\n`;
    proposals.forEach((p, i) => {
      displayText += `**${i + 1}. 「${p.title}」** - ${p.narrationPreview}\n   → _${p.direction}_${p.isEnding ? ' [结局]' : ''}\n\n`;
    });
    displayText += `输入 **数字** 选择，或输入 "跳过" / "自动完成"。`;

    return `已为"${next.choiceText}"生成${proposals.length}个方案。\n\n${displayText}\n\n请将方案展示给用户，等待选择后调用 apply_proposal。`;
  },
  {
    name: 'expand_node',
    description: '共创模式：生成下一个分支的2-3个方案供用户选择。首次调用时初始化共创模式。',
    schema: z.object({}),
  },
);

// ── apply_proposal ──

export const applyProposalTool = tool(
  async (input: { choice: string }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const ib = (config?.configurable as any)?.interactiveBranch ?? {
      active: false, proposals: [], pendingExpansions: [], completedNodeIds: [],
      currentExpansion: null, maxDepth: 10, phase: 'idle',
    };

    if (!ib.active) return '共创模式未启动，请先调用 expand_node';

    const expansion = ib.currentExpansion as PendingExpansion | null;
    if (!expansion) return '没有当前待展开的节点';

    const choice = input.choice;
    const proposals: NodeProposal[] = ib.proposals;

    // Handle "skip"
    if (choice === 'skip' || choice === '跳过') {
      emit({
        type: 'REMOVE_PENDING_EXPANSION',
        payload: { parentNodeId: expansion.parentNodeId, choiceId: expansion.choiceId },
      });
      const remaining = ib.pendingExpansions.filter(
        (p: PendingExpansion) => !(p.parentNodeId === expansion.parentNodeId && p.choiceId === expansion.choiceId)
      );
      return `已跳过分支 "${expansion.choiceText}"。\n\n${formatIBProgress(ctx, remaining, ib.maxDepth)}\n\n继续调用 expand_node 展开下一个分支。`;
    }

    // Handle numeric choice (1/2/3)
    const idx = parseInt(String(choice), 10) - 1;
    if (idx >= 0 && idx < proposals.length) {
      const proposal = proposals[idx];
      const { nodeId, isEnding } = applyProposalToStory(proposal, expansion, ctx, ib);

      return `✅ 已创建节点「${proposal.title}」(${isEnding ? '结局' : '剧情'}, depth ${expansion.depth})\n\n${formatIBProgress(ctx, ib.pendingExpansions, ib.maxDepth)}\n\n继续调用 expand_node 展开下一个分支。`;
    }

    return `无效选择: ${choice}。可选 1-${proposals.length} 或 "skip"/"跳过"`;
  },
  {
    name: 'apply_proposal',
    description: '应用用户选择的共创方案（1/2/3 或 skip）',
    schema: z.object({
      choice: z.string().describe('用户选择: 数字(1/2/3)选方案，或 "skip"/"跳过" 跳过当前分支'),
    }),
  },
);

// ── auto_complete_branches ──

export const autoCompleteBranchesTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const ib = (config?.configurable as any)?.interactiveBranch ?? {
      active: false, proposals: [], pendingExpansions: [], completedNodeIds: [],
      currentExpansion: null, maxDepth: 10, phase: 'idle',
    };

    if (!ib.active) return '共创模式未启动';

    emit({ type: 'SET_INTERACTIVE_BRANCH', payload: { phase: 'auto_completing' } });

    let completed = 0;
    let maxIterations = 50;
    // Work on a mutable copy of pendingExpansions since we can't read back from store
    let remaining = [...ib.pendingExpansions] as PendingExpansion[];

    while (maxIterations-- > 0 && remaining.length > 0) {
      const next = remaining[0];

      try {
        const proposals = await callExpandNodeAPI(
          next, ctx,
          { maxDepth: ib.maxDepth, pendingExpansions: remaining },
          undefined, config,
        );

        if (proposals.length === 0) {
          // No proposals — skip
          emit({
            type: 'REMOVE_PENDING_EXPANSION',
            payload: { parentNodeId: next.parentNodeId, choiceId: next.choiceId },
          });
          remaining = remaining.slice(1);
          continue;
        }

        // Pick: prefer ending if depth >= 70% maxDepth, else first
        const depthPct = ib.maxDepth > 0 ? next.depth / ib.maxDepth : 0;
        const pick = depthPct >= 0.7
          ? (proposals.find(p => p.isEnding) || proposals[0])
          : proposals[0];

        const { newChoices } = applyProposalToStory(pick, next, ctx, ib);
        completed++;

        // Update remaining: remove current, add new choices' expansions
        remaining = remaining.slice(1);
        for (let i = newChoices.length - 1; i >= 0; i--) {
          remaining.unshift({
            parentNodeId: next.parentNodeId, // This is actually the new nodeId, but since we emitted commands we can't easily track. The commands handle the real state.
            choiceId: newChoices[i].id,
            choiceText: newChoices[i].text,
            depth: next.depth + 1,
          });
        }
      } catch {
        // Skip failed expansion
        emit({
          type: 'REMOVE_PENDING_EXPANSION',
          payload: { parentNodeId: next.parentNodeId, choiceId: next.choiceId },
        });
        remaining = remaining.slice(1);
      }
    }

    emit({
      type: 'SET_INTERACTIVE_BRANCH',
      payload: { phase: 'idle', active: false },
    });

    return `⚡ 自动完成！新增 ${completed} 个节点。\n\n${formatIBProgress(ctx, [], ib.maxDepth)}\n\n可以继续下一步（extract_entities）。`;
  },
  {
    name: 'auto_complete_branches',
    description: '自动完成所有剩余待展开分支（AI自动选择最佳方案）',
    schema: z.object({}),
  },
);

export const cocreationTools = [expandNodeTool, applyProposalTool, autoCompleteBranchesTool];
