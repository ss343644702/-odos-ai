/**
 * Generation tools — LLM-powered content creation.
 * These call skill APIs and emit StoryCommands for state mutations.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { v4 as uuid } from 'uuid';
import type { StoryNode, StoryEdge } from '@/types/story';
import { PRESET_STYLES } from '../../types';
import type { StoryCommand } from '../commands';
import { getStoryContext } from './utility';
import { callSkillAPI, getBaseUrl } from './skillApi';

// ── Command accumulator ──
let _pendingCommands: StoryCommand[] = [];
export function drainGenCommands(): StoryCommand[] {
  const cmds = _pendingCommands;
  _pendingCommands = [];
  return cmds;
}
function emit(cmd: StoryCommand) { _pendingCommands.push(cmd); }

// ── select_style ──

export const selectStyleTool = tool(
  async (input: { styleId: string }): Promise<string> => {
    const style = PRESET_STYLES.find(s => s.styleId === input.styleId);
    if (!style) {
      const available = PRESET_STYLES.map(s => `${s.styleId}(${s.styleName})`).join(', ');
      return `未找到风格 "${input.styleId}"。可选风格：${available}`;
    }
    emit({ type: 'SET_STYLE', payload: style });
    return `已选择风格：${style.styleName}（${style.colorTone}，${style.lightingStyle}）`;
  },
  {
    name: 'select_style',
    description: `选择视觉风格。可选: ${PRESET_STYLES.map(s => `${s.styleId}(${s.styleName})`).join(', ')}`,
    schema: z.object({
      styleId: z.string().describe('风格 ID'),
    }),
  },
);

// ── generate_outline ──

export const generateOutlineTool = tool(
  async (input: { storyDescription?: string; depth?: number }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const desc = input.storyDescription || ctx.storyDescription;
    if (!desc) return '缺少故事描述';
    if (!ctx.style) return '请先选择风格（select_style）';

    const outline = await callSkillAPI('outlineGenerator', {
      storyDescription: desc,
      style: ctx.style,
      depth: input.depth,
    }, undefined, config);

    emit({ type: 'SET_OUTLINE', payload: outline });
    if (outline.worldView) emit({ type: 'SET_WORLD_VIEW', payload: outline.worldView });

    const charSummary = (outline.characters || [])
      .map((c: any) => `${c.name}(${c.role})${c.secret ? `[秘密: ${c.secret}]` : ''}`)
      .join('\n  ');
    const plotPoints = outline.plotPoints || outline.mainPlotPoints || [];
    const plotSummary = plotPoints
      .map((p: any, i: number) => `${i + 1}. ${p.title}：${p.description}${p.conflict ? `\n   冲突：${p.conflict}` : ''}${p.suspense ? `\n   悬念：${p.suspense}` : ''}`)
      .join('\n');
    const endingSummary = (outline.endings || [])
      .map((e: any) => `[${e.type}] ${e.title}：${e.description}${e.requirement ? `（条件：${e.requirement}）` : ''}`)
      .join('\n');

    return [
      `大纲生成完成`,
      `\n📖 主题：${outline.theme}`,
      outline.worldView ? `🌍 世界观：${outline.worldView}` : '',
      `🎭 基调：${outline.tone || '未指定'}`,
      `📊 层级深度：${outline.depth} 层`,
      `\n👥 角色（${outline.characters?.length || 0}）：\n  ${charSummary}`,
      plotSummary ? `\n📋 情节脉络：\n${plotSummary}` : '',
      endingSummary ? `\n🏁 结局方向（${outline.endings?.length || 0}）：\n${endingSummary}` : '',
    ].filter(Boolean).join('\n');
  },
  {
    name: 'generate_outline',
    description: '生成故事大纲（主题、角色、情节脉络、结局方向）',
    schema: z.object({
      storyDescription: z.string().optional().describe('故事描述（不提供则使用已设置的）'),
      depth: z.number().optional().describe('剧情层级深度（默认由系统决定）'),
    }),
  },
);

// ── Helper functions for generate_branches ──

function inferNodeType(n: any, i: number): 'start' | 'scene' | 'ending' {
  const type = n.type || n.data?.type;
  if (type && ['start', 'scene', 'ending'].includes(type)) return type;
  if (i === 0) return 'start';
  const choices = n.data?.choices || n.choices || [];
  if (choices.length === 0) {
    const title = (n.data?.title || n.title || '').toLowerCase();
    if (/结局|ending|end/.test(title)) return 'ending';
  }
  return 'scene';
}

function repairBranchStructure(nodes: StoryNode[], edges: StoryEdge[]): { nodes: StoryNode[]; edges: StoryEdge[]; repairs: string[] } {
  const repairs: string[] = [];
  const nodeIds = new Set(nodes.map(n => n.id));

  for (const node of nodes) {
    for (const choice of node.data.choices) {
      if (choice.targetNodeId && !nodeIds.has(choice.targetNodeId)) {
        const stripped = choice.targetNodeId.replace(/[_-]/g, '');
        const match = nodes.find(n => n.id.replace(/[_-]/g, '') === stripped);
        if (match) { choice.targetNodeId = match.id; repairs.push(`修复: 选项目标 → ${match.id}`); }
        else { choice.targetNodeId = ''; repairs.push(`警告: 选项指向不存在节点，已移除`); }
      }
    }
    node.data.choices = node.data.choices.filter(c => c.targetNodeId);
  }

  for (const node of nodes) {
    if (node.data.choices.length === 0 && node.type !== 'ending' && node.type !== 'story_config') {
      (node as any).type = 'ending';
      node.data.allowCustomInput = false;
      repairs.push(`修复: 叶子节点"${node.data.title}" 标记为结局`);
    }
  }

  const existingEdgeKeys = new Set(edges.map(e => `${e.source}->${e.target}`));
  for (const node of nodes) {
    for (const choice of node.data.choices) {
      const key = `${node.id}->${choice.targetNodeId}`;
      if (!existingEdgeKeys.has(key)) {
        edges.push({ id: uuid(), source: node.id, target: choice.targetNodeId, sourceHandle: choice.id, label: choice.text, type: 'authored' });
        existingEdgeKeys.add(key);
        repairs.push(`修复: 补充缺失边 ${node.id} → ${choice.targetNodeId}`);
      }
    }
  }

  const validEdges = edges.filter(e => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) { repairs.push(`修复: 移除无效边`); return false; }
    return true;
  });

  return { nodes, edges: validEdges, repairs };
}

// ── generate_branches ──

export const generateBranchesTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (!ctx.outline) return '请先生成大纲（generate_outline）';
    if (!ctx.style) return '请先选择风格（select_style）';

    const result = await callSkillAPI('branchGenerator', {
      outline: ctx.outline,
      style: ctx.style,
    }, undefined, config);

    const review = result.selfReview;

    const nodes: StoryNode[] = (result.nodes || []).map((n: any, i: number) => ({
      id: n.id || uuid(),
      type: inferNodeType(n, i),
      position: n.position || { x: 0, y: 0 },
      data: {
        title: n.data?.title || n.title || `节点${i + 1}`,
        narration: n.data?.narration || n.narration || '',
        dialogue: n.data?.dialogue || n.dialogue || null,
        character: n.data?.character || n.character || null,
        imageUrl: null,
        imagePrompt: n.data?.imagePrompt || n.imagePrompt || '',
        audioUrl: null,
        choices: (n.data?.choices || n.choices || []).map((c: any) => ({
          id: c.id || uuid(), text: c.text || '', targetNodeId: c.targetNodeId || c.target || '',
        })),
        allowCustomInput: (n.type === 'ending') ? false : true,
        depth: n.data?.depth ?? n.depth ?? 0,
        voiceSegments: [], frames: [],
        metadata: { tags: [], storyContext: '' },
      },
    }));

    // Fix sourceHandle
    const nodeChoiceMap = new Map<string, Map<string, string>>();
    for (const node of nodes) {
      const m = new Map<string, string>();
      for (const c of node.data.choices) { if (c.targetNodeId) m.set(c.targetNodeId, c.id); }
      nodeChoiceMap.set(node.id, m);
    }

    const edges: StoryEdge[] = (result.edges || []).map((e: any) => {
      let sh = e.sourceHandle || '';
      if (!sh || sh.startsWith('choice-')) {
        const tm = nodeChoiceMap.get(e.source);
        if (tm) sh = tm.get(e.target) || sh;
      }
      if (!sh) {
        const src = nodes.find(n => n.id === e.source);
        if (src?.data.choices.length) sh = src.data.choices[0].id;
      }
      return { id: e.id || uuid(), source: e.source, target: e.target, sourceHandle: sh, label: e.label || '', type: (e.type || 'authored') as any };
    });

    const repaired = repairBranchStructure(nodes, edges);

    // Note: layoutNodes runs client-side (depends on DOM). We skip it here;
    // the client will auto-layout via ReactFlow fitView.
    const configNode: StoryNode = {
      id: 'story-config',
      type: 'story_config' as const,
      position: { x: 0, y: -120 },
      data: {
        title: '故事配置', narration: '', dialogue: null, character: null,
        imageUrl: null, imagePrompt: '', audioUrl: null,
        choices: [], allowCustomInput: false, depth: -1,
        voiceSegments: [], frames: [],
        metadata: { tags: [], storyContext: '' },
      },
    };

    emit({ type: 'SET_NODES_AND_EDGES', payload: { nodes: [configNode, ...repaired.nodes], edges: repaired.edges } });

    const summary = `分支剧情生成完成：${nodes.length}个节点，${repaired.edges.length}条边${review ? `，自检评分 ${review.rating}/10` : ''}`;
    return repaired.repairs.length > 0
      ? `${summary}\n\n结构修复：\n${repaired.repairs.join('\n')}`
      : summary;
  },
  {
    name: 'generate_branches',
    description: '一次性生成完整分支剧情树（仅快速模式使用）',
    schema: z.object({}),
  },
);

// ── extract_entities ──

export const extractEntitiesTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (ctx.nodeCount === 0) return '没有剧情节点，请先生成分支';

    const nodes = ctx.fullNodes || ctx.nodes.map(n => ({ id: n.id, data: { title: n.title } }));
    const entities = await callSkillAPI('entityExtractor', {
      nodes,
      style: ctx.style,
    }, undefined, config);

    emit({ type: 'SET_ENTITIES', payload: entities });
    return `主体提取完成：${entities.characters?.length || 0}个角色，${entities.scenes?.length || 0}个场景，${entities.props?.length || 0}个道具`;
  },
  {
    name: 'extract_entities',
    description: '从剧情节点中提取角色、场景、道具',
    schema: z.object({}),
  },
);

// ── generate_entity_images ──

export const generateEntityImagesTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (!ctx.entities) return '请先提取主体（extract_entities）';

    const baseUrl = getBaseUrl(config);
    const stylePrefix = ctx.style?.stylePromptPrefix || '';

    const tasks: { type: 'characters' | 'scenes' | 'props'; id: string; prompt: string; aspectRatio: string }[] = [];
    for (const c of (ctx.entities.characters || []) as any[]) {
      if (c.imagePrompt) tasks.push({ type: 'characters', id: c.id, prompt: `${stylePrefix}${c.imagePrompt}`, aspectRatio: '3:4' });
    }
    for (const s of (ctx.entities.scenes || []) as any[]) {
      if (s.imagePrompt) tasks.push({ type: 'scenes', id: s.id, prompt: `${stylePrefix}${s.imagePrompt}`, aspectRatio: '16:9' });
    }
    for (const p of (ctx.entities.props || []) as any[]) {
      if (p.imagePrompt) tasks.push({ type: 'props', id: p.id, prompt: `${stylePrefix}${p.imagePrompt}`, aspectRatio: '1:1' });
    }
    if (tasks.length === 0) return '没有需要生成图片的主体';

    let completed = 0, failed = 0;
    const signal = config?.signal as AbortSignal | undefined;

    for (let i = 0; i < tasks.length; i += 3) {
      if (signal?.aborted) throw new Error('已取消');
      const batch = tasks.slice(i, i + 3);

      const results = await Promise.allSettled(
        batch.map(async (task) => {
          const res = await fetch(`${baseUrl}/api/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: task.prompt, aspectRatio: task.aspectRatio }),
            signal,
          });
          const data = await res.json();
          if (!data.success || !data.taskId) throw new Error(data.error || 'Submit failed');

          let delay = 2000;
          for (let attempt = 0; attempt < 15; attempt++) {
            if (signal?.aborted) throw new Error('已取消');
            await new Promise(r => setTimeout(r, delay));
            const poll = await fetch(`${baseUrl}/api/generate-image?taskId=${data.taskId}`, { signal });
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
          emit({ type: 'UPDATE_ENTITY_IMAGE', payload: { entityType: r.value.type, id: r.value.id, imageUrl: r.value.imageUrl } });
        } else { failed++; }
      }
    }

    return `参考图生成完成：${completed - failed}/${tasks.length} 成功${failed > 0 ? `，${failed} 个失败` : ''}`;
  },
  {
    name: 'generate_entity_images',
    description: '为角色、场景、道具生成参考图片',
    schema: z.object({}),
  },
);

// ── generate_storyboard ──

export const generateStoryboardTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (!ctx.entities || ctx.nodeCount === 0) return '缺少剧情节点或主体数据';

    const nodes = ctx.fullNodes || [];
    const storyNodes = nodes.filter(n => n.type !== 'story_config');
    if (storyNodes.length === 0) return '没有可处理的节点（需要 fullNodes 数据）';

    const signal = config?.signal as AbortSignal | undefined;
    let success = 0;

    for (let i = 0; i < storyNodes.length; i += 3) {
      if (signal?.aborted) throw new Error('已取消');
      const batch = storyNodes.slice(i, i + 3);

      const results = await Promise.allSettled(
        batch.map(node =>
          callSkillAPI('storyboardGenerator', { node: { id: node.id, data: node.data }, entities: ctx.entities, style: ctx.style }, signal, config),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          const sb = (results[j] as PromiseFulfilledResult<any>).value;
          const frames = (sb.frames || []).map((f: any) => ({
            id: uuid(), narrationSegment: f.narrationSegment || '', imagePrompt: f.imagePrompt || '',
            imageUrl: null, entityRefs: f.entityRefs || [], duration: f.duration || 3,
          }));
          emit({
            type: 'UPDATE_NODE',
            payload: {
              nodeId: batch[j].id,
              data: { imagePrompt: sb.imagePrompt || frames[0]?.imagePrompt || '', frames },
            },
          });
          success++;
        }
      }
    }

    // Note: Frame image generation (Keling) is skipped in initial migration.
    // Can be added as a separate tool or handled client-side.
    return `分镜生成完成：${success}/${storyNodes.length} 个节点`;
  },
  {
    name: 'generate_storyboard',
    description: '为每个剧情节点生成分镜（画面帧）',
    schema: z.object({}),
  },
);

// ── generate_voice ──

export const generateVoiceTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (!ctx.entities || ctx.nodeCount === 0) return '缺少剧情节点或主体数据';

    const nodes = ctx.fullNodes || [];
    const storyNodes = nodes.filter(n => n.type !== 'story_config');
    if (storyNodes.length === 0) return '没有可处理的节点（需要 fullNodes 数据）';

    const baseUrl = getBaseUrl(config);
    const signal = config?.signal as AbortSignal | undefined;
    let segmentCount = 0, audioCount = 0;

    // Phase 1: Voice segmentation
    for (let i = 0; i < storyNodes.length; i += 3) {
      if (signal?.aborted) throw new Error('已取消');
      const batch = storyNodes.slice(i, i + 3);

      const results = await Promise.allSettled(
        batch.map(node =>
          callSkillAPI('voiceGenerator', {
            storyboard: { nodeId: node.id, frames: node.data.frames || [] },
            entities: ctx.entities,
          }, signal, config),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          const voice = (results[j] as PromiseFulfilledResult<any>).value;
          const segments = (voice.voiceSegments || voice.segments || []).map((s: any) => ({
            text: s.text,
            voiceType: (s.speaker === 'narrator' || s.voiceType === 'narrator') ? 'narrator' : (s.voiceType || 'narrator'),
            speaker: s.speaker || 'narrator',
            speed: s.speed || 1,
            audioUrl: null,
          }));
          emit({ type: 'UPDATE_NODE', payload: { nodeId: batch[j].id, data: { voiceSegments: segments } } });
          segmentCount += segments.length;
        }
      }
    }

    // Phase 2: TTS generation
    for (const node of storyNodes) {
      if (signal?.aborted) throw new Error('已取消');
      const segments = node.data.voiceSegments || [];

      for (let s = 0; s < segments.length; s++) {
        if (segments[s].audioUrl) { audioCount++; continue; }
        try {
          const res = await fetch(`${baseUrl}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: segments[s].text, voiceType: segments[s].voiceType, speed: segments[s].speed }),
            signal,
          });
          const data = await res.json();
          if (data.audioUrl) {
            segments[s] = { ...segments[s], audioUrl: data.audioUrl };
            audioCount++;
          }
        } catch { /* skip failed TTS */ }
      }

      emit({ type: 'UPDATE_NODE', payload: { nodeId: node.id, data: { voiceSegments: [...segments] } } });
    }

    return `配音生成完成：${segmentCount} 个分段，${audioCount} 个音频`;
  },
  {
    name: 'generate_voice',
    description: '为每个节点生成配音分段和 TTS 音频',
    schema: z.object({}),
  },
);

export const generationTools = [
  selectStyleTool,
  generateOutlineTool,
  generateBranchesTool,
  extractEntitiesTool,
  generateEntityImagesTool,
  generateStoryboardTool,
  generateVoiceTool,
];
