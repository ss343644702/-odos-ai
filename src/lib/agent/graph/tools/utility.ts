/**
 * Utility tools — read-only state inspection.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StoryContextSnapshot } from '../state';

// ── Shared helper to extract story context from tool config ──
// In LangGraph, tools receive a RunnableConfig. We inject storyContext into
// config.configurable so tools can read state without Zustand.
export function getStoryContext(config?: RunnableConfig): StoryContextSnapshot {
  return (config?.configurable as any)?.storyContext ?? {
    storyDescription: '',
    style: null,
    outline: null,
    entities: null,
    nodes: [],
    edges: [],
    nodeCount: 0,
    endingCount: 0,
    nodesWithFrames: 0,
    nodesWithVoice: 0,
  };
}

export const getStateTool = tool(
  async (_input: Record<string, unknown>, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    const parts: string[] = [];
    parts.push(`故事描述: ${ctx.storyDescription || '(未设置)'}`);
    parts.push(`风格: ${ctx.style?.styleName || '(未选择)'}`);
    parts.push(`大纲: ${ctx.outline ? `${ctx.outline.theme}, ${ctx.outline.depth}层` : '(未生成)'}`);
    parts.push(`节点数: ${ctx.nodeCount}`);
    parts.push(`主体: ${ctx.entities ? `${ctx.entities.characters?.length || 0}角色, ${ctx.entities.scenes?.length || 0}场景` : '(未提取)'}`);
    parts.push(`已分镜: ${ctx.nodesWithFrames} 个节点`);
    parts.push(`已配音: ${ctx.nodesWithVoice} 个节点`);
    return parts.join('\n');
  },
  {
    name: 'get_state',
    description: '查看当前创作进度（风格、大纲、节点数、主体、分镜、配音状态）',
    schema: z.object({}),
  },
);

export const listNodesTool = tool(
  async (input: { verbose?: boolean }, config?: RunnableConfig): Promise<string> => {
    const ctx = getStoryContext(config);
    if (ctx.nodes.length === 0) return '当前没有剧情节点';

    const typeIcons: Record<string, string> = { start: '🟢', scene: '📖', ending: '🔴', ai_generated: '🤖' };
    const nodeList = ctx.nodes
      .map((n, i) => {
        const icon = typeIcons[n.type] || '📄';
        const outEdges = ctx.edges.filter(e => e.source === n.id);
        const connections = outEdges
          .map(e => {
            const ti = ctx.nodes.findIndex(t => t.id === e.target);
            return ti >= 0 ? ti : '?';
          })
          .join(',');
        return `[${i}] ${icon} ${n.type} - "${n.title || '无标题'}" (${n.choiceCount}选项, ${n.frameCount}帧${connections ? `, →${connections}` : ''})`;
      })
      .join('\n');

    let result = `共 ${ctx.nodes.length} 个节点：\n${nodeList}`;
    if (input.verbose) {
      result += `\n\n共 ${ctx.edges.length} 条连线`;
      result += `\n结局节点: ${ctx.endingCount} 个`;
    }
    return result;
  },
  {
    name: 'list_nodes',
    description: '列出所有剧情节点（序号、类型、标题、选项数、帧数、连接）',
    schema: z.object({
      verbose: z.boolean().optional().describe('是否显示详细信息（连线数、结局数）'),
    }),
  },
);

export const utilityTools = [getStateTool, listNodesTool];
