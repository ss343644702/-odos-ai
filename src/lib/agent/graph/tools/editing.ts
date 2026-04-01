/**
 * Editing tools — CRUD operations on nodes, edges, choices, frames.
 * Each tool returns a text result for the LLM observation.
 * Side effects are dispatched as StoryCommands via the graph state.
 *
 * Since LangGraph ToolNode doesn't natively support returning both text AND
 * state updates, we use a pattern where tools store pending commands in a
 * module-level queue. The custom tool node wrapper drains this queue after
 * each tool call and merges commands into graph state.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StoryCommand } from '../commands';
import { getStoryContext } from './utility';
import type { StoryNode, StoryEdge } from '@/types/story';
import { v4 as uuid } from 'uuid';

// ── Command accumulator ──
// Tools push commands here; the tool node wrapper drains after each call.
let _pendingCommands: StoryCommand[] = [];
export function drainPendingCommands(): StoryCommand[] {
  const cmds = _pendingCommands;
  _pendingCommands = [];
  return cmds;
}
function emit(cmd: StoryCommand) { _pendingCommands.push(cmd); }

// ── Helpers ──

function resolveNode(config: RunnableConfig | undefined, indexKey: string, val: unknown) {
  const ctx = getStoryContext(config);
  const idx = typeof val === 'number' ? val : -1;
  if (idx < 0 || idx >= ctx.nodes.length) return null;
  const compact = ctx.nodes[idx];
  // Also look up full node data if available
  const full = ctx.fullNodes?.find(n => n.id === compact.id);
  return { compact, full, id: compact.id, index: idx };
}

function nodeIndexError(config: RunnableConfig | undefined, key: string, val: unknown): string {
  const ctx = getStoryContext(config);
  return `${key}=${val} 超出范围 (0-${ctx.nodes.length - 1})`;
}

// ── edit_node ──

export const editNodeTool = tool(
  async (input: { nodeIndex: number; field: string; newValue: string }, config?: RunnableConfig): Promise<string> => {
    const validFields = ['narration', 'title', 'dialogue', 'character', 'imagePrompt', 'allowCustomInput'];
    if (!validFields.includes(input.field)) {
      return `无效字段 "${input.field}"，可选：${validFields.join(', ')}`;
    }
    const resolved = resolveNode(config, 'nodeIndex', input.nodeIndex);
    if (!resolved) return nodeIndexError(config, 'nodeIndex', input.nodeIndex);

    emit({ type: 'UPDATE_NODE', payload: { nodeId: resolved.id, data: { [input.field]: input.newValue } as any } });
    return `已修改节点 "${resolved.compact.title}" 的 ${input.field}`;
  },
  {
    name: 'edit_node',
    description: '修改节点的单个字段（narration/title/dialogue/character/imagePrompt/allowCustomInput）',
    schema: z.object({
      nodeIndex: z.number().describe('节点序号'),
      field: z.string().describe('要修改的字段名'),
      newValue: z.string().describe('新值'),
    }),
  },
);

// ── manage_node ──

export const manageNodeTool = tool(
  async (input: {
    action: string;
    type?: string;
    title?: string;
    narration?: string;
    afterNodeIndex?: number;
    nodeIndex?: number;
    x?: number;
    y?: number;
  }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);

    if (input.action === 'add') {
      const nodeType = input.type || 'scene';
      const title = input.title || '新节点';
      const narration = input.narration || '';
      const afterIdx = input.afterNodeIndex;

      let x = 300, y = 200;
      if (typeof afterIdx === 'number' && afterIdx >= 0 && afterIdx < ctx.nodes.length) {
        const afterNode = ctx.fullNodes?.find(n => n.id === ctx.nodes[afterIdx].id);
        if (afterNode) { x = afterNode.position.x + 300; y = afterNode.position.y; }
      } else if (ctx.nodes.length > 0 && ctx.fullNodes) {
        const maxX = Math.max(...ctx.fullNodes.map(n => n.position.x));
        x = maxX + 300;
      }

      const newId = uuid();
      const newNode: StoryNode = {
        id: newId,
        type: nodeType as StoryNode['type'],
        position: { x, y },
        data: {
          title, narration, dialogue: null, character: null,
          imageUrl: null, imagePrompt: '', audioUrl: null,
          choices: [], allowCustomInput: false, depth: 0,
          voiceSegments: [], frames: [],
          metadata: { tags: [], storyContext: '' },
        },
      };
      emit({ type: 'ADD_NODE', payload: newNode });

      if (typeof afterIdx === 'number' && afterIdx >= 0 && afterIdx < ctx.nodes.length) {
        const sourceId = ctx.nodes[afterIdx].id;
        emit({
          type: 'ADD_EDGE',
          payload: { id: uuid(), source: sourceId, target: newId, sourceHandle: 'default', label: '', type: 'authored' },
        });
      }

      return `已添加节点 "${title}" (${nodeType})${typeof afterIdx === 'number' ? `，已连接从节点 [${afterIdx}]` : ''}`;
    }

    if (input.action === 'remove') {
      const resolved = resolveNode(config, 'nodeIndex', input.nodeIndex);
      if (!resolved) return nodeIndexError(config, 'nodeIndex', input.nodeIndex);
      emit({ type: 'REMOVE_NODE', payload: { nodeId: resolved.id } });
      return `已删除节点 "${resolved.compact.title}" 及其关联连线`;
    }

    if (input.action === 'move') {
      const resolved = resolveNode(config, 'nodeIndex', input.nodeIndex);
      if (!resolved) return nodeIndexError(config, 'nodeIndex', input.nodeIndex);
      if (typeof input.x !== 'number' || typeof input.y !== 'number') return '需要提供 x 和 y 坐标';
      emit({ type: 'UPDATE_NODE_POSITION', payload: { nodeId: resolved.id, position: { x: input.x, y: input.y } } });
      return `已移动节点 "${resolved.compact.title}" 到 (${input.x}, ${input.y})`;
    }

    return `未知操作 "${input.action}"，可选: add, remove, move`;
  },
  {
    name: 'manage_node',
    description: '管理节点：add（添加）、remove（删除）、move（移动）',
    schema: z.object({
      action: z.enum(['add', 'remove', 'move']).describe('操作类型'),
      type: z.string().optional().describe('节点类型: scene/ending (add)'),
      title: z.string().optional().describe('节点标题 (add)'),
      narration: z.string().optional().describe('节点叙述 (add)'),
      afterNodeIndex: z.number().optional().describe('插入到哪个节点后面 (add)'),
      nodeIndex: z.number().optional().describe('目标节点序号 (remove/move)'),
      x: z.number().optional().describe('X 坐标 (move)'),
      y: z.number().optional().describe('Y 坐标 (move)'),
    }),
  },
);

// ── manage_edge ──

export const manageEdgeTool = tool(
  async (input: {
    action: string;
    sourceNodeIndex?: number;
    targetNodeIndex?: number;
    label?: string;
  }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);

    if (input.action === 'list') {
      if (ctx.edges.length === 0) return '当前没有连线';
      const lines = ctx.edges.map(e => {
        const si = ctx.nodes.findIndex(n => n.id === e.source);
        const ti = ctx.nodes.findIndex(n => n.id === e.target);
        const sName = si >= 0 ? `[${si}] ${ctx.nodes[si].title}` : e.source;
        const tName = ti >= 0 ? `[${ti}] ${ctx.nodes[ti].title}` : e.target;
        return `${sName} → ${tName}${e.label ? ` [${e.label}]` : ''}`;
      });
      return `共 ${ctx.edges.length} 条连线：\n${lines.join('\n')}`;
    }

    if (input.action === 'add') {
      const src = resolveNode(config, 'sourceNodeIndex', input.sourceNodeIndex);
      if (!src) return nodeIndexError(config, 'sourceNodeIndex', input.sourceNodeIndex);
      const tgt = resolveNode(config, 'targetNodeIndex', input.targetNodeIndex);
      if (!tgt) return nodeIndexError(config, 'targetNodeIndex', input.targetNodeIndex);

      emit({
        type: 'ADD_EDGE',
        payload: { id: uuid(), source: src.id, target: tgt.id, sourceHandle: 'default', label: input.label || '', type: 'authored' },
      });
      return `已添加连线：[${input.sourceNodeIndex}] "${src.compact.title}" → [${input.targetNodeIndex}] "${tgt.compact.title}"`;
    }

    if (input.action === 'remove') {
      const src = resolveNode(config, 'sourceNodeIndex', input.sourceNodeIndex);
      if (!src) return nodeIndexError(config, 'sourceNodeIndex', input.sourceNodeIndex);
      const tgt = resolveNode(config, 'targetNodeIndex', input.targetNodeIndex);
      if (!tgt) return nodeIndexError(config, 'targetNodeIndex', input.targetNodeIndex);

      const edge = ctx.edges.find(e => e.source === src.id && e.target === tgt.id);
      if (!edge) return '未找到该连线';
      emit({ type: 'REMOVE_EDGE', payload: { edgeId: edge.id } });
      return `已删除连线：[${input.sourceNodeIndex}] → [${input.targetNodeIndex}]`;
    }

    return `未知操作 "${input.action}"，可选: add, remove, list`;
  },
  {
    name: 'manage_edge',
    description: '管理连线：add（添加）、remove（删除）、list（列出）',
    schema: z.object({
      action: z.enum(['add', 'remove', 'list']).describe('操作类型'),
      sourceNodeIndex: z.number().optional().describe('起始节点序号'),
      targetNodeIndex: z.number().optional().describe('目标节点序号'),
      label: z.string().optional().describe('连线标签文字'),
    }),
  },
);

// ── manage_choice ──

export const manageChoiceTool = tool(
  async (input: {
    action: string;
    nodeIndex: number;
    choiceIndex?: number;
    text?: string;
    targetNodeIndex?: number;
  }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const resolved = resolveNode(config, 'nodeIndex', input.nodeIndex);
    if (!resolved) return nodeIndexError(config, 'nodeIndex', input.nodeIndex);

    const fullNode = resolved.full;
    const choices = fullNode?.data.choices || [];

    if (input.action === 'add') {
      if (!input.text) return '需要提供选项文字 (text)';
      let targetNodeId = '';
      if (typeof input.targetNodeIndex === 'number') {
        const tgt = resolveNode(config, 'targetNodeIndex', input.targetNodeIndex);
        if (!tgt) return nodeIndexError(config, 'targetNodeIndex', input.targetNodeIndex);
        targetNodeId = tgt.id;
      }
      const choiceId = uuid();
      emit({ type: 'ADD_CHOICE', payload: { nodeId: resolved.id, choice: { id: choiceId, text: input.text, targetNodeId } } });
      return `已为节点 "${resolved.compact.title}" 添加选项 "${input.text}"`;
    }

    if (input.action === 'update') {
      if (typeof input.choiceIndex !== 'number' || input.choiceIndex < 0 || input.choiceIndex >= choices.length) {
        return `choiceIndex=${input.choiceIndex} 超出范围 (0-${choices.length - 1})`;
      }
      const choice = choices[input.choiceIndex];
      const updates: Record<string, unknown> = {};
      if (input.text) updates.text = input.text;
      if (typeof input.targetNodeIndex === 'number') {
        const tgt = resolveNode(config, 'targetNodeIndex', input.targetNodeIndex);
        if (!tgt) return nodeIndexError(config, 'targetNodeIndex', input.targetNodeIndex);
        updates.targetNodeId = tgt.id;
      }
      emit({ type: 'UPDATE_CHOICE', payload: { nodeId: resolved.id, choiceId: choice.id, updates: updates as any } });
      return `已更新节点 "${resolved.compact.title}" 的选项 [${input.choiceIndex}]`;
    }

    if (input.action === 'remove') {
      if (typeof input.choiceIndex !== 'number' || input.choiceIndex < 0 || input.choiceIndex >= choices.length) {
        return `choiceIndex=${input.choiceIndex} 超出范围 (0-${choices.length - 1})`;
      }
      const choice = choices[input.choiceIndex];
      // Also remove associated edge
      if (choice.targetNodeId) {
        const edge = ctx.edges.find(e => e.source === resolved.id && e.target === choice.targetNodeId);
        if (edge) emit({ type: 'REMOVE_EDGE', payload: { edgeId: edge.id } });
      }
      emit({ type: 'REMOVE_CHOICE', payload: { nodeId: resolved.id, choiceId: choice.id } });
      return `已删除节点 "${resolved.compact.title}" 的选项 "${choice.text}"`;
    }

    return `未知操作 "${input.action}"，可选: add, update, remove`;
  },
  {
    name: 'manage_choice',
    description: '管理节点选项：add（添加）、update（修改）、remove（删除）',
    schema: z.object({
      action: z.enum(['add', 'update', 'remove']).describe('操作类型'),
      nodeIndex: z.number().describe('节点序号'),
      choiceIndex: z.number().optional().describe('选项序号 (update/remove)'),
      text: z.string().optional().describe('选项文字 (add/update)'),
      targetNodeIndex: z.number().optional().describe('目标节点序号 (add/update)'),
    }),
  },
);

// ── manage_frame ──

export const manageFrameTool = tool(
  async (input: {
    action: string;
    nodeIndex: number;
    frameIndex?: number;
    narrationSegment?: string;
    imagePrompt?: string;
    duration?: number;
  }, config?: RunnableConfig): Promise<string> => {
    const resolved = resolveNode(config, 'nodeIndex', input.nodeIndex);
    if (!resolved) return nodeIndexError(config, 'nodeIndex', input.nodeIndex);

    const frames = resolved.full?.data.frames || [];

    if (input.action === 'add') {
      const frame = {
        id: uuid(),
        narrationSegment: input.narrationSegment || '',
        imagePrompt: input.imagePrompt || '',
        imageUrl: null as string | null,
        entityRefs: [] as string[],
        duration: input.duration || 3,
      };
      emit({ type: 'ADD_FRAME', payload: { nodeId: resolved.id, frame } });
      return `已为节点 "${resolved.compact.title}" 添加画面帧`;
    }

    if (input.action === 'update') {
      if (typeof input.frameIndex !== 'number' || input.frameIndex < 0 || input.frameIndex >= frames.length) {
        return `frameIndex=${input.frameIndex} 超出范围 (0-${frames.length - 1})`;
      }
      const frame = frames[input.frameIndex];
      const updates: Record<string, unknown> = {};
      if (input.narrationSegment !== undefined) updates.narrationSegment = input.narrationSegment;
      if (input.imagePrompt !== undefined) updates.imagePrompt = input.imagePrompt;
      if (input.duration !== undefined) updates.duration = input.duration;
      emit({ type: 'UPDATE_FRAME', payload: { nodeId: resolved.id, frameId: frame.id, updates: updates as any } });
      return `已更新节点 "${resolved.compact.title}" 的画面帧 [${input.frameIndex}]`;
    }

    if (input.action === 'remove') {
      if (typeof input.frameIndex !== 'number' || input.frameIndex < 0 || input.frameIndex >= frames.length) {
        return `frameIndex=${input.frameIndex} 超出范围 (0-${frames.length - 1})`;
      }
      emit({ type: 'REMOVE_FRAME', payload: { nodeId: resolved.id, frameId: frames[input.frameIndex].id } });
      return `已删除节点 "${resolved.compact.title}" 的画面帧 [${input.frameIndex}]`;
    }

    return `未知操作 "${input.action}"，可选: add, update, remove`;
  },
  {
    name: 'manage_frame',
    description: '管理画面帧：add（添加）、update（修改）、remove（删除）',
    schema: z.object({
      action: z.enum(['add', 'update', 'remove']).describe('操作类型'),
      nodeIndex: z.number().describe('节点序号'),
      frameIndex: z.number().optional().describe('画面帧序号 (update/remove)'),
      narrationSegment: z.string().optional().describe('叙述分段 (add/update)'),
      imagePrompt: z.string().optional().describe('图片描述 (add/update)'),
      duration: z.number().optional().describe('持续时间秒 (add/update)'),
    }),
  },
);

// ── reset_story ──

export const resetStoryTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (ctx.nodeCount === 0) return '没有故事数据';
    emit({ type: 'RESET_STORY' });
    return `已清空故事画布：删除了 ${ctx.nodeCount} 个节点和所有连线。可以重新开始创作。`;
  },
  {
    name: 'reset_story',
    description: '清空所有节点和连线，重新开始创作',
    schema: z.object({}),
  },
);

export const editingTools = [
  editNodeTool,
  manageNodeTool,
  manageEdgeTool,
  manageChoiceTool,
  manageFrameTool,
  resetStoryTool,
];
