/**
 * LangGraph StateGraph — the core agent graph (stateless per-request).
 *
 * Each user message triggers an independent graph run. No checkpoint/resume.
 * Context comes from client-side storyContext injected into the system prompt.
 *
 * Nodes:
 *   agent     — LLM reasoning with bound tools
 *   tool_node — executes tool calls, drains pending commands
 *
 * Edges:
 *   START → agent → (router) → tool_node | END
 *   tool_node → agent
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import { AgentState } from './state';
import type { AgentStateType, StoryContextSnapshot } from './state';
import type { StoryCommand } from './commands';
import { buildAgentSystemPrompt } from './prompt';

// ── Tools ──
import { utilityTools } from './tools/utility';
import { editingTools, drainPendingCommands } from './tools/editing';
import { generationTools, drainGenCommands } from './tools/generation';
import { cocreationTools, drainCocreationCommands } from './tools/cocreation';

export const allTools = [
  ...utilityTools,
  ...editingTools,
  ...generationTools,
  ...cocreationTools,
];

// ── LLM ──
function createModel() {
  return new ChatOpenAI({
    model: 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: { baseURL: 'https://api.deepseek.com/v1' },
    temperature: 0.3,
    maxTokens: 2048,
  }).bindTools(allTools);
}

// ── Serialize storyContext for the LLM system prompt ──
function serializeStoryContext(ctx: StoryContextSnapshot | undefined): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.storyDescription) parts.push(`故事描述: ${ctx.storyDescription}`);
  if (ctx.style) parts.push(`已选风格: ${ctx.style.styleName}`);
  if (ctx.outline) {
    const points = ctx.outline.plotPoints || ctx.outline.mainPlotPoints || [];
    const titles = points.map(p => p.title).filter(Boolean);
    if (titles.length > 0) parts.push(`大纲情节点: ${titles.join(', ')}`);
    parts.push(`大纲主题: ${ctx.outline.theme}, 深度: ${ctx.outline.depth}`);
  }
  if (ctx.entities) {
    const allEntities = Object.values(ctx.entities).flat();
    if (allEntities.length > 0) parts.push(`主体: ${allEntities.length} 个`);
  }
  if (ctx.nodeCount > 0) {
    parts.push(`节点: ${ctx.nodeCount} 个, 结局: ${ctx.endingCount} 个`);
    if (ctx.nodes?.length > 0) {
      const summary = ctx.nodes.slice(0, 20).map(
        n => `${n.id}(${n.title}, type=${n.type}, depth=${n.depth})`
      ).join('; ');
      parts.push(`节点列表: ${summary}`);
    }
    parts.push(`已有分镜: ${ctx.nodesWithFrames}/${ctx.nodeCount}, 已有配音: ${ctx.nodesWithVoice}/${ctx.nodeCount}`);
  }
  return parts.join('\n');
}

// ── Get context from state (updated by tool_node) or config (initial) ──
function getContext(state: AgentStateType, config?: RunnableConfig) {
  const configurable = config?.configurable as Record<string, unknown> | undefined;
  const configCtx = configurable?.storyContext as AgentStateType['storyContext'] | undefined;
  const ib = configurable?.interactiveBranch as AgentStateType['interactiveBranch'] | undefined;

  // After turn 0, prefer state.storyContext — it's been updated by tool_node
  // with command effects (style, outline, nodes, etc.)
  const storyContext = state.turnCount > 0 && state.storyContext
    ? state.storyContext
    : (configCtx || state.storyContext);

  return {
    storyContext,
    interactiveBranch: ib ?? state.interactiveBranch,
  };
}

// ── Agent node ──
async function agentNode(
  state: AgentStateType,
  config?: RunnableConfig,
): Promise<Partial<AgentStateType>> {
  const model = createModel();
  const { storyContext, interactiveBranch } = getContext(state, config);

  const ctxSummary = serializeStoryContext(storyContext);
  const systemPrompt = buildAgentSystemPrompt(state.mode, ctxSummary);

  console.log('[agentNode] turn:', state.turnCount, 'mode:', state.mode, 'msgs:', state.messages.length);
  console.log('[agentNode] context:', ctxSummary || '(empty)');

  const toolConfig: RunnableConfig = {
    ...config,
    configurable: {
      ...config?.configurable,
      storyContext,
      interactiveBranch,
    },
  };

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...state.messages,
  ];

  const response = await model.invoke(messages, toolConfig);

  return {
    messages: [response],
    turnCount: state.turnCount + 1,
    storyContext,
    interactiveBranch,
  };
}

// ── Apply commands to storyContext in-memory ──
// So subsequent agent turns within the same graph run see updated state.
function applyCommandsToContext(
  ctx: StoryContextSnapshot,
  commands: StoryCommand[],
): StoryContextSnapshot {
  let updated = { ...ctx };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'SET_STYLE':
        updated = { ...updated, style: cmd.payload };
        break;
      case 'SET_OUTLINE':
        updated = { ...updated, outline: cmd.payload };
        break;
      case 'SET_ENTITIES':
        updated = { ...updated, entities: cmd.payload };
        break;
      case 'SET_STORY_DESCRIPTION':
        updated = { ...updated, storyDescription: cmd.payload };
        break;
      case 'SET_NODES_AND_EDGES': {
        const nodes = (cmd.payload.nodes || [])
          .filter((n: any) => n.type !== 'story_config')
          .map((n: any) => ({
            id: n.id, type: n.type, title: n.data?.title || n.title || '',
            depth: n.data?.depth ?? n.depth ?? 0,
            choiceCount: n.data?.choices?.length || 0,
            frameCount: n.data?.frames?.length || 0,
            hasVoice: (n.data?.voiceSegments?.length || 0) > 0,
          }));
        const edges = (cmd.payload.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, label: e.label,
        }));
        updated = {
          ...updated,
          nodes, edges,
          nodeCount: nodes.length,
          endingCount: nodes.filter((n: any) => n.type === 'ending').length,
        };
        break;
      }
      case 'ADD_NODES_AND_EDGES': {
        const newNodes = (cmd.payload.nodes || [])
          .filter((n: any) => n.type !== 'story_config')
          .map((n: any) => ({
            id: n.id, type: n.type, title: n.data?.title || n.title || '',
            depth: n.data?.depth ?? n.depth ?? 0,
            choiceCount: n.data?.choices?.length || 0,
            frameCount: n.data?.frames?.length || 0,
            hasVoice: (n.data?.voiceSegments?.length || 0) > 0,
          }));
        const newEdges = (cmd.payload.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, label: e.label,
        }));
        const allNodes = [...(updated.nodes || []), ...newNodes];
        const allEdges = [...(updated.edges || []), ...newEdges];
        updated = {
          ...updated,
          nodes: allNodes, edges: allEdges,
          nodeCount: allNodes.length,
          endingCount: allNodes.filter((n: any) => n.type === 'ending').length,
        };
        break;
      }
      // Skip other command types — they don't affect agent decision-making
    }
  }
  return updated;
}

// ── Custom tool node ──
async function customToolNode(
  state: AgentStateType,
  config?: RunnableConfig,
): Promise<Partial<AgentStateType>> {
  const { storyContext, interactiveBranch } = getContext(state, config);

  const toolConfig: RunnableConfig = {
    ...config,
    configurable: {
      ...config?.configurable,
      storyContext,
      interactiveBranch,
    },
  };

  const toolNode = new ToolNode(allTools);
  const result = await toolNode.invoke(state, toolConfig);

  const commands: StoryCommand[] = [
    ...drainPendingCommands(),
    ...drainGenCommands(),
    ...drainCocreationCommands(),
  ];

  // Update storyContext with command effects so next agent turn sees them
  const updatedContext = commands.length > 0
    ? applyCommandsToContext(storyContext, commands)
    : storyContext;

  return {
    ...result,
    commands: commands.length > 0 ? commands : [],
    storyContext: updatedContext,
    interactiveBranch,
  };
}

// ── Router ──
function routeAfterAgent(state: AgentStateType): string {
  const lastMsg = state.messages[state.messages.length - 1];

  if (state.turnCount >= 30) return '__end__';

  if (
    lastMsg &&
    typeof lastMsg === 'object' &&
    'tool_calls' in lastMsg &&
    Array.isArray((lastMsg as AIMessage).tool_calls) &&
    (lastMsg as AIMessage).tool_calls!.length > 0
  ) {
    return 'tool_node';
  }

  // No tool calls → agent wants to talk to user → end this run
  return '__end__';
}

// ── Build graph ──
export function buildGraph() {
  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tool_node', customToolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, {
      tool_node: 'tool_node',
      __end__: END,
    })
    .addEdge('tool_node', 'agent');

  return graph.compile();
}

// ── Singleton graph instance ──
let _graph: ReturnType<typeof buildGraph> | null = null;

export function getGraph() {
  if (!_graph) {
    _graph = buildGraph();
  }
  return _graph;
}
