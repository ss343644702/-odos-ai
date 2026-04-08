'use client';

import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useStoryStore } from '@/stores/storyStore';
import { useEditorStore } from '@/stores/editorStore';
import { PRESET_STYLES } from '@/lib/agent/types';
import type { SkillName, PendingExpansion } from '@/lib/agent/types';
import type { StoryNode, StoryEdge, StoryOutline } from '@/types/story';
// Pipeline mode removed — ReAct only
import { v4 as uuid } from 'uuid';
import { useReactLoop } from '@/hooks/useReactLoop';
import { layoutNodes } from '@/lib/layout';

const skillLabels: Record<SkillName, string> = {
  styleConfirm: '画面风格',
  outlineGenerator: '剧本大纲',
  branchGenerator: '分支剧情',
  entityExtractor: '主体提取',
  storyboardGenerator: '分镜生成',
  voiceGenerator: '配音生成',
};

const skillShortLabels: Record<SkillName, string> = {
  styleConfirm: '风格',
  outlineGenerator: '大纲',
  branchGenerator: '分支',
  entityExtractor: '主体',
  storyboardGenerator: '分镜',
  voiceGenerator: '配音',
};

const skillIcons: Record<SkillName, string> = {
  styleConfirm: '🎨',
  outlineGenerator: '📋',
  branchGenerator: '🌿',
  entityExtractor: '👤',
  storyboardGenerator: '🎬',
  voiceGenerator: '🎙️',
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
    issues.push(`${danglingLeaves.length} 个叶子节点不是结局类型：${danglingLeaves.map(n => `"${n.data.title}"`).join('、')}`);
  }
  const endingCount = nodes.filter(n => n.type === 'ending').length;
  if (endingCount === 0) {
    issues.push('没有任何结局节点');
  }
  return issues;
}

// Helper: format outline for display
function formatOutline(outline: StoryOutline): string {
  const chars = (outline.characters || [])
    .map((c) => `  - ${c.name} (${c.role}): ${c.description}${c.secret ? `\n    🔒 秘密: ${c.secret}` : ''}`)
    .join('\n');

  // Support both new plotPoints and legacy mainPlotPoints
  const plotPoints = outline.plotPoints || outline.mainPlotPoints || [];
  const plots = plotPoints
    .map((p, i) => {
      let line = `  ${i + 1}. **${p.title}**: ${p.description}`;
      if (p.hook) line += `\n    🪝 钩子: ${p.hook}`;
      if ('dilemma' in p && p.dilemma) line += `\n    ⚖️ 两难: ${p.dilemma}`;
      if ('stakes' in p && p.stakes) line += `\n    🎯 赌注: ${p.stakes}`;
      if (p.conflict) line += `\n    ⚡ 冲突: ${p.conflict}`;
      if (p.suspense) line += `\n    🔮 悬念: ${p.suspense}`;
      return line;
    })
    .join('\n');

  const endings = (outline.endings || [])
    .map((e) => `  - ${e.title} (${e.type}): ${e.description}${e.requirement ? `\n    📌 条件: ${e.requirement}` : ''}`)
    .join('\n');

  const sections = [
    `📋 **剧本大纲已生成**`,
    `\n**主题**: ${outline.theme}`,
    `**世界观**: ${outline.worldView}`,
    `**基调**: ${outline.tone}`,
    `**层级**: ${outline.depth}层`,
    `**结局数**: ${(outline.endings || []).length}个`,
    `\n**角色**:\n${chars}`,
    `\n**情节脉络**:\n${plots}`,
    `\n**结局方向**:\n${endings}`,
    `\n请确认大纲方向，或告诉我需要修改的地方。`,
    `\n确认后请选择创作方式：`,
    `**1. 🤝 共创模式** — 逐节点对话，你来把控每个剧情走向`,
    `**2. ⚡ 快速模式** — AI 一次性生成完整分支树`,
    `\n输入 **1** 或 **2** 选择（推荐共创模式）`,
  ];

  return sections.filter(Boolean).join('\n');
}

export default function AgentChat() {
  const agentPanelOpen = useEditorStore((s) => s.agentPanelOpen);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const orchestrator = useChatStore((s) => s.orchestrator);
  const addMessage = useChatStore((s) => s.addMessage);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const setCurrentSkill = useChatStore((s) => s.setCurrentSkill);
  const updateSkillStatus = useChatStore((s) => s.updateSkillStatus);
  const setStoryDescription = useChatStore((s) => s.setStoryDescription);
  const setSelectedStyle = useChatStore((s) => s.setSelectedStyle);
  const setOutline = useChatStore((s) => s.setOutline);
  const confirmSkill = useChatStore((s) => s.confirmSkill);
  const initStory = useStoryStore((s) => s.initStory);
  const setStyle = useStoryStore((s) => s.setStyle);
  const setNodesAndEdges = useStoryStore((s) => s.setNodesAndEdges);
  const setWorldView = useStoryStore((s) => s.setWorldView);

  // ReAct mode only (pipeline removed)

  const story = useStoryStore((s) => s.story);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const newReplyAnchorRef = useRef<HTMLDivElement>(null);
  const hasScrolledToReply = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestedDepthRef = useRef<number | undefined>(undefined);

  // LangGraph agent
  const reactLoop = useReactLoop();

  // Smart scroll: when user sends a message, scroll to bottom to show it.
  // When agent starts replying, scroll once to show the reply top, then stop.
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];

    if (lastMsg.role === 'user') {
      // User just sent — scroll to bottom so they see their own message
      hasScrolledToReply.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (lastMsg.role === 'assistant' && !hasScrolledToReply.current) {
      // First assistant message in this round — scroll to its top, once
      hasScrolledToReply.current = true;
      // Use rAF to wait for DOM render
      requestAnimationFrame(() => {
        if (newReplyAnchorRef.current && chatContainerRef.current) {
          const container = chatContainerRef.current;
          const anchor = newReplyAnchorRef.current;
          const anchorTop = anchor.offsetTop - container.offsetTop;
          container.scrollTo({ top: anchorTop, behavior: 'smooth' });
        }
      });
    }
  }, [messages]);

  // Auto-derive skill progress from actual story data (on mount + data changes)
  // Skip for empty stories (fresh /editor/new) to avoid false positives from stale hydration
  useEffect(() => {
    if (!story) return;
    const contentNodes = (story.nodes || []).filter(n => n.type !== 'story_config');
    // Don't sync skills for empty projects — let the creation flow manage it
    if (contentNodes.length === 0) return;
    const { orchestrator: orch } = useChatStore.getState();
    // Don't override while agent is actively running
    if (orch.skills.some(s => s.status === 'running')) return;

    const nodes = contentNodes;
    const hasStyle = !!story.style?.styleId;
    const hasNodes = nodes.length > 0;
    const hasEdges = (story.edges || []).length > 0;
    const hasEntities = !!(orch.entities?.characters?.length);
    // Frames/voice require ALL content nodes to be complete
    const allHaveFrames = hasNodes && nodes.every(n => (n.data.frames?.length ?? 0) > 0);
    const allHaveVoice = hasNodes && nodes.every(n => (n.data.voiceSegments?.length ?? 0) > 0);

    if (hasStyle && orch.skills.find(s => s.name === 'styleConfirm')?.status === 'idle') updateSkillStatus('styleConfirm', 'completed');
    if (hasNodes && hasEdges) {
      if (orch.skills.find(s => s.name === 'outlineGenerator')?.status === 'idle') updateSkillStatus('outlineGenerator', 'completed');
      if (orch.skills.find(s => s.name === 'branchGenerator')?.status === 'idle') updateSkillStatus('branchGenerator', 'completed');
    }
    if (hasEntities && orch.skills.find(s => s.name === 'entityExtractor')?.status === 'idle') updateSkillStatus('entityExtractor', 'completed');
    if (allHaveFrames && orch.skills.find(s => s.name === 'storyboardGenerator')?.status === 'idle') updateSkillStatus('storyboardGenerator', 'completed');
    if (allHaveVoice && orch.skills.find(s => s.name === 'voiceGenerator')?.status === 'idle') updateSkillStatus('voiceGenerator', 'completed');
  }, [story?.nodes, story?.edges, story?.style, updateSkillStatus]);

  // Send welcome message on first render
  const welcomeSent = useRef(false);
  useEffect(() => {
    if (messages.length === 0 && !welcomeSent.current) {
      welcomeSent.current = true;
      addMessage({
        role: 'assistant',
        content: '你好！我是你的互动影游创作助手 🎬\n\n告诉我你想创作什么故事，只需要几句话描述即可。例如：\n\n"一个职场新人面临各种选择的故事"\n"古代修仙者在仙魔大战中的冒险"\n"末日废土中寻找家人的旅程"',
      });
    }
  }, []);

  // Call generate-story API with SSE streaming for real-time feedback
  const callSkillAPI = useCallback(
    async (skill: string, skillInput: Record<string, unknown>): Promise<unknown> => {
      // Use streaming for heavy skills (branchGenerator, outlineGenerator, entityExtractor)
      const useStream = ['branchGenerator', 'outlineGenerator', 'entityExtractor', 'storyboardGenerator', 'voiceGenerator', 'expandNode'].includes(skill);

      if (useStream) {
        const res = await fetch('/api/generate-story-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill, input: skillInput }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Skill ${skill} stream failed: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: unknown = null;

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
      }

      // Fallback: non-streaming for styleConfirm and chat
      const res = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, input: skillInput }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'API call failed');
      }
      return res.json();
    },
    []
  );

  // Run outline generation with real API
  const runOutlineGeneration = useCallback(
    async (description: string, style: { styleName: string; stylePromptPrefix: string }) => {
      setStreaming(true);
      setCurrentSkill('outlineGenerator');
      updateSkillStatus('outlineGenerator', 'running');

      addMessage({
        role: 'assistant',
        content: `已选择「${style.styleName}」风格 ✓\n\n正在为你生成剧本大纲...\n（融入钩子、冲突、悬念设计，${requestedDepthRef.current ? `控制在${requestedDepthRef.current}层` : '根据故事实际情况选择合理深度'}，设计2-4个结局）\n\n⏳ AI 生成中，请稍候...`,
        skillName: 'outlineGenerator',
      });

      try {
        const outline = (await callSkillAPI('outlineGenerator', {
          storyDescription: description,
          style,
          depth: requestedDepthRef.current,
        })) as StoryOutline;

        setOutline(outline);
        if (outline.worldView) {
          setWorldView(outline.worldView);
        }

        addMessage({
          role: 'assistant',
          content: formatOutline(outline),
          skillName: 'outlineGenerator',
          confirmRequired: true,
        });
        updateSkillStatus('outlineGenerator', 'waiting_confirm');
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        addMessage({
          role: 'assistant',
          content: `⚠️ 大纲生成失败: ${errMsg}\n\n请重新描述你的故事，或输入"重试"再次尝试。`,
          skillName: 'outlineGenerator',
        });
        updateSkillStatus('outlineGenerator', 'idle');
        setCurrentSkill('styleConfirm');
      } finally {
        setStreaming(false);
      }
    },
    [addMessage, callSkillAPI, setCurrentSkill, setOutline, setStreaming, setWorldView, updateSkillStatus]
  );

  // Run branch generation with real API
  const runBranchGeneration = useCallback(async () => {
    const outline = useChatStore.getState().orchestrator.outline;
    const style = useChatStore.getState().orchestrator.style;
    if (!outline) return;

    setStreaming(true);
    setCurrentSkill('branchGenerator');
    updateSkillStatus('branchGenerator', 'running');

    addMessage({
      role: 'assistant',
      content: '🌿 正在生成分支剧情树...\n\n（设计迷惑性选项、隐藏线索、收束到主线结局）\n\n⏳ AI 生成中，这可能需要30秒左右...',
      skillName: 'branchGenerator',
    });

    try {
      const result = (await callSkillAPI('branchGenerator', {
        outline,
        style,
      })) as { nodes: StoryNode[]; edges: StoryEdge[]; selfReview?: { rating: number; strengths: string[]; issues: string[]; fixes: string[] } };

      // Ensure nodes have proper structure
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

      // Build a lookup: for each node, map target -> choice.id
      const nodeChoiceMap = new Map<string, Map<string, string>>();
      for (const node of nodes) {
        const targetToChoice = new Map<string, string>();
        for (const c of node.data.choices) {
          if (c.targetNodeId) targetToChoice.set(c.targetNodeId, c.id);
        }
        nodeChoiceMap.set(node.id, targetToChoice);
      }

      const edges: StoryEdge[] = (result.edges || []).map((e: any) => {
        // Try to match sourceHandle to the correct choice ID
        let sourceHandle = e.sourceHandle || '';
        if (!sourceHandle || sourceHandle.startsWith('choice-')) {
          // Look up the correct choice ID from the source node's choices
          const targetMap = nodeChoiceMap.get(e.source);
          if (targetMap) {
            sourceHandle = targetMap.get(e.target) || sourceHandle;
          }
        }
        // If still no match, try first choice of source node
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

      // Check for ending issues
      const endingIssues = checkEndingIssues(nodes, edges);

      // Layout nodes in tree form (left-to-right)
      const layoutedNodes = layoutNodes(nodes, edges);

      // Add story config node above the root
      const rootNode = layoutedNodes.find((n) => n.type === 'start') || layoutedNodes[0];
      const configNode = {
        id: 'story-config',
        type: 'story_config' as const,
        position: { x: (rootNode?.position?.x || 0), y: (rootNode?.position?.y || 0) - 120 },
        data: {
          title: useStoryStore.getState().story?.title || '故事配置',
          narration: '', dialogue: null, character: null,
          imageUrl: null, imagePrompt: '', audioUrl: null,
          choices: [], allowCustomInput: false, depth: -1,
          voiceSegments: [], frames: [],
          metadata: { tags: [], storyContext: '' },
        },
      };
      const allNodes = [configNode, ...layoutedNodes];

      setNodesAndEdges(allNodes, edges);

      // Build self-review report
      let reviewText = '';
      if (result.selfReview) {
        const sr = result.selfReview;
        reviewText = `\n\n🔍 **自检报告** (评分: ${sr.rating}/10)：\n`;
        if (sr.strengths?.length) reviewText += `✅ 优点：${sr.strengths.join('；')}\n`;
        if (sr.issues?.length) reviewText += `⚠️ 问题：${sr.issues.join('；')}\n`;
        if (sr.fixes?.length) reviewText += `🔧 修正：${sr.fixes.join('；')}\n`;
      }

      const endingWarning = endingIssues.length > 0
        ? `\n\n⚠️ **结构问题**：${endingIssues.join('；')}。建议检查并补充完整剧情。`
        : '';

      addMessage({
        role: 'assistant',
        content: `✅ **分支剧情树已生成！**\n\n📊 统计：\n- ${nodes.length} 个剧情节点\n- ${edges.length} 条分支路线\n- ${nodes.filter((n) => n.type === 'ending').length} 个结局\n- 最大深度 ${Math.max(...nodes.map((n) => n.data.depth))} 层${reviewText}${endingWarning}\n\n故事树已在画布上展示，你可以：\n1. 点击任意节点查看/修改详情\n2. 继续对话让我优化某个节点\n3. 输入"继续"进入主体提取和分镜生成`,
        skillName: 'branchGenerator',
        confirmRequired: true,
      });
      updateSkillStatus('branchGenerator', 'completed');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage({
        role: 'assistant',
        content: `⚠️ 分支剧情生成失败: ${errMsg}\n\n输入"重试"重新生成，或修改大纲后再试。`,
        skillName: 'branchGenerator',
      });
      updateSkillStatus('branchGenerator', 'idle');
    } finally {
      setStreaming(false);
    }
  }, [addMessage, callSkillAPI, setCurrentSkill, setNodesAndEdges, setStreaming, updateSkillStatus]);

  // ════════════════════════════════════════════════════════
  // Interactive Branch Co-Creation
  // ════════════════════════════════════════════════════════

  const {
    setInteractiveBranch,
    addPendingExpansion,
    removePendingExpansion,
    clearInteractiveBranch,
  } = useChatStore.getState();

  /** Calculate how many choices each node should have based on depth/progress */
  const calcChoiceCount = useCallback((depth: number, maxDepth: number, totalNodes: number): number => {
    const depthPct = maxDepth > 0 ? depth / maxDepth : 0;
    if (totalNodes >= 25) return 0;
    if (depthPct >= 0.7 || totalNodes > 15) return 1;
    if (depthPct >= 0.4) return 2;
    return 2;
  }, []);

  /** Build the branch path from root to a given node (for context continuity) */
  const getBranchPath = useCallback((nodeId: string): string[] => {
    const story = useStoryStore.getState().story;
    if (!story) return [];
    const path: string[] = [];
    let currentId = nodeId;
    let safety = 20;
    while (currentId && safety-- > 0) {
      const node = (story.nodes || []).find(n => n.id === currentId);
      if (!node) break;
      path.unshift(node.data.title);
      const inEdge = (story.edges || []).find(e => e.target === currentId);
      currentId = inEdge?.source || '';
    }
    return path;
  }, []);

  /** Format progress status for interactive branch building */
  const formatBranchProgress = useCallback(() => {
    const ib = useChatStore.getState().orchestrator.interactiveBranch;
    const story = useStoryStore.getState().story;
    const nodeCount = story ? (story.nodes || []).filter(n => n.type !== 'story_config').length : 0;
    const endings = story ? (story.nodes || []).filter(n => n.type === 'ending').length : 0;
    const maxDepth = ib.maxDepth;
    const deepest = ib.completedNodeIds.length > 0 && story
      ? Math.max(...(story.nodes || []).filter(n => ib.completedNodeIds.includes(n.id)).map(n => n.data.depth), 0)
      : 0;
    const pending = ib.pendingExpansions;

    let status = `📊 **进度**: ${nodeCount}/25 节点 | ${endings} 个结局 | 待展开 ${pending.length} 条 | 最深 ${deepest}/${maxDepth} 层`;

    // Show current storyline context (DFS: first pending is what we're following)
    if (pending.length > 0) {
      const next = pending[0];
      const branchPath = getBranchPath(next.parentNodeId);
      if (branchPath.length > 0) {
        status += `\n\n📍 **当前故事线**: ${branchPath.slice(-3).join(' → ')} → ?`;
      }
      // Show other pending branches (deferred)
      if (pending.length > 1) {
        status += `\n\n🔀 **其他待展开** (${pending.length - 1}条，当前线完成后自动进入):`;
        for (const p of pending.slice(1, 4)) {
          const parentNode = story?.nodes?.find(n => n.id === p.parentNodeId);
          status += `\n  - "${p.choiceText}" ← 「${parentNode?.data.title || ''}」`;
        }
        if (pending.length > 4) status += `\n  ...还有${pending.length - 4}条`;
      }
    }
    return status;
  }, [getBranchPath]);

  /** Call expandNode API and return proposals */
  const callExpandNode = useCallback(async (expansion: PendingExpansion) => {
    const ib = useChatStore.getState().orchestrator.interactiveBranch;
    const outline = useChatStore.getState().orchestrator.outline;
    const story = useStoryStore.getState().story;
    if (!outline) throw new Error('Missing outline');

    // For root expansion, use outline theme as parent context
    const isRoot = expansion.parentNodeId === '__root__';
    const parentNode = isRoot
      ? { data: { title: '故事开场', narration: outline.worldView || outline.theme } } as StoryNode
      : story?.nodes?.find(n => n.id === expansion.parentNodeId);
    if (!parentNode) throw new Error('Missing parent node');

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
    }) as { proposals: any[] };

    return (result.proposals || []).map((p: any, i: number) => ({
      id: `p${i + 1}`,
      title: p.title || `方案${i + 1}`,
      narrationPreview: p.narrationPreview || p.fullNode?.narration?.slice(0, 80) || '',
      direction: p.direction || '',
      isEnding: p.isEnding || false,
      fullNode: p.fullNode || {},
    }));
  }, [callSkillAPI, calcChoiceCount, getBranchPath]);

  /** Apply a chosen proposal: create node, edges, update pending */
  const applyProposal = useCallback((proposal: any, expansion: PendingExpansion) => {
    const story = useStoryStore.getState().story;
    if (!story) return;

    const { addNode, addEdge, updateChoice } = useStoryStore.getState();
    const ib = useChatStore.getState().orchestrator.interactiveBranch;

    // Create the new node
    const nodeId = `node_${uuid().slice(0, 8)}`;
    const nodeType = proposal.isEnding ? 'ending' : (expansion.depth === 0 ? 'start' : 'scene');
    const choices = proposal.isEnding ? [] : (proposal.fullNode.choices || []).map((c: any) => ({
      id: `c_${uuid().slice(0, 6)}`,
      text: c.text,
      targetNodeId: '', // will be filled when expanded
    }));

    // Position: offset from parent
    const parentNode = (story.nodes || []).find(n => n.id === expansion.parentNodeId);
    const parentPos = parentNode?.position || { x: 0, y: 0 };
    const siblingCount = (story.nodes || []).filter(n =>
      (story.edges || []).some(e => e.source === expansion.parentNodeId && e.target === n.id)
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

    // Create edge from parent to new node (skip for root expansion)
    const isRoot = expansion.parentNodeId === '__root__';
    if (!isRoot) {
      const edgeId = `edge_${uuid().slice(0, 8)}`;
      addEdge({
        id: edgeId,
        source: expansion.parentNodeId,
        target: nodeId,
        sourceHandle: expansion.choiceId,
        label: expansion.choiceText,
        type: 'authored',
      });

      // Update parent's choice targetNodeId
      updateChoice(expansion.parentNodeId, expansion.choiceId, { targetNodeId: nodeId });
    }

    // Remove this expansion from pending
    removePendingExpansion(expansion.parentNodeId, expansion.choiceId);

    // Add new pending expansions for this node's choices
    // Insert in reverse order so first choice ends up at front (DFS: continue current branch)
    for (let i = choices.length - 1; i >= 0; i--) {
      addPendingExpansion({
        parentNodeId: nodeId,
        choiceId: choices[i].id,
        choiceText: choices[i].text,
        depth: expansion.depth + 1,
      });
    }

    // Track completed node
    setInteractiveBranch({
      completedNodeIds: [...ib.completedNodeIds, nodeId],
    });

    return nodeId;
  }, [removePendingExpansion, addPendingExpansion, setInteractiveBranch]);

  /** Expand the next pending branch: call API, show proposals */
  const expandNextBranch = useCallback(async () => {
    const ib = useChatStore.getState().orchestrator.interactiveBranch;
    if (ib.pendingExpansions.length === 0) {
      // All done!
      setInteractiveBranch({ phase: 'idle', active: false });
      updateSkillStatus('branchGenerator', 'completed');
      addMessage({
        role: 'assistant',
        content: `🎉 **分支剧情构建完成！**\n\n${formatBranchProgress()}\n\n输入"继续"进行下一步（主体提取和分镜生成）。`,
        skillName: 'branchGenerator',
      });
      setStreaming(false);
      return;
    }

    // DFS: pick first in queue (child of last expanded node, continuing current storyline)
    const next = ib.pendingExpansions[0];

    // Detect storyline switch: compare branch paths
    const story = useStoryStore.getState().story;
    const prevExpansion = ib.currentExpansion;
    let isSwitchingBranch = false;
    if (prevExpansion && prevExpansion.parentNodeId !== '__root__') {
      // If next expansion depth is shallower than or equal to previous, we backtracked
      isSwitchingBranch = next.depth <= prevExpansion.depth;
    }

    const parentNode = story?.nodes?.find(n => n.id === next.parentNodeId);

    if (isSwitchingBranch) {
      const branchPath = getBranchPath(next.parentNodeId);
      addMessage({
        role: 'assistant',
        content: `✅ **当前故事线已到达结局！**\n\n${formatBranchProgress()}\n\n---\n\n🔀 **切换到新分支**: "${next.choiceText}" ← 来自「${parentNode?.data.title || ''}」\n📍 故事线: ${branchPath.slice(-3).join(' → ')} → ?\n\n⏳ 生成方案中...`,
        skillName: 'branchGenerator',
      });
    } else {
      addMessage({
        role: 'assistant',
        content: `${formatBranchProgress()}\n\n---\n\n🔀 展开选项: **"${next.choiceText}"** ← 来自「${parentNode?.data.title || ''}」\n\n⏳ 生成方案中...`,
        skillName: 'branchGenerator',
      });
    }

    setInteractiveBranch({ phase: 'generating', currentExpansion: next });

    try {
      const proposals = await callExpandNode(next);
      setInteractiveBranch({ phase: 'waiting_creator', proposals });

      // Format proposals for display
      let proposalText = `${formatBranchProgress()}\n\n---\n\n🔀 **"${next.choiceText}"** ← 来自「${parentNode?.data.title || ''}」\n\n`;
      proposals.forEach((p: any, i: number) => {
        proposalText += `**${i + 1}️⃣ ${p.title}**${p.isEnding ? ' 🔴结局' : ''}\n${p.narrationPreview}\n→ _${p.direction}_\n\n`;
      });
      proposalText += `输入 **数字** 选择方案，或直接写你想要的剧情内容。\n也可以输入"跳过"（标为结局）或"自动完成"（AI完成剩余所有分支）。`;

      // Update the last message with proposals
      useChatStore.getState().updateLastAssistantMessage(proposalText);
      setStreaming(false);
    } catch (err: any) {
      setInteractiveBranch({ phase: 'waiting_creator', proposals: [] });
      useChatStore.getState().updateLastAssistantMessage(
        `⚠️ 生成方案失败: ${err.message}\n\n输入"重试"重新生成，或直接写你想要的剧情内容。`
      );
      setStreaming(false);
    }
  }, [callExpandNode, formatBranchProgress, setInteractiveBranch, updateSkillStatus, addMessage, setStreaming]);

  /** Start the interactive branch building flow */
  const runInteractiveBranch = useCallback(async () => {
    const outline = useChatStore.getState().orchestrator.outline;
    if (!outline) return;

    setStreaming(true);
    setCurrentSkill('branchGenerator');
    updateSkillStatus('branchGenerator', 'running');

    const maxDepth = outline.depth || 10;

    // Initialize interactive branch state
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
        type: 'story_config',
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
      setNodesAndEdges([configNode], []);
    }

    addMessage({
      role: 'assistant',
      content: `🤝 **共创模式启动！**\n\n我会逐步为你提供剧情方案，你来选择和调整。\n层级深度：${maxDepth} 层\n\n⏳ 正在生成开场方案...`,
      skillName: 'branchGenerator',
    });

    // Generate opening node proposals
    // For the opening, we create a virtual "root" expansion
    const rootExpansion: PendingExpansion = {
      parentNodeId: '__root__',
      choiceId: '__start__',
      choiceText: '故事开场',
      depth: 0,
    };

    try {
      const proposals = await callExpandNode({
        ...rootExpansion,
        // Override: for opening, use a different parent context
        parentNodeId: '__root__',
      } as any);

      setInteractiveBranch({ phase: 'waiting_creator', proposals, currentExpansion: rootExpansion });

      let proposalText = `🤝 **共创模式** | 深度 ${maxDepth} 层\n\n**开场方案：**\n\n`;
      proposals.forEach((p: any, i: number) => {
        proposalText += `**${i + 1}️⃣ ${p.title}**\n${p.narrationPreview}\n→ _${p.direction}_\n\n`;
      });
      proposalText += `输入 **数字** 选择方案，或直接写你想要的开场内容。`;

      useChatStore.getState().updateLastAssistantMessage(proposalText);
      setStreaming(false);
    } catch (err: any) {
      addMessage({
        role: 'assistant',
        content: `⚠️ 生成开场方案失败: ${err.message}\n\n输入"重试"重新生成。`,
        skillName: 'branchGenerator',
      });
      setStreaming(false);
    }
  }, [addMessage, callExpandNode, setCurrentSkill, setInteractiveBranch, setNodesAndEdges, setStreaming, updateSkillStatus]);

  /** Handle creator's response during interactive branch building */
  const handleInteractiveBranchInput = useCallback(async (text: string) => {
    const ib = useChatStore.getState().orchestrator.interactiveBranch;
    if (!ib.active || ib.phase !== 'waiting_creator') return false;

    const expansion = ib.currentExpansion;
    if (!expansion) return false;

    const trimmed = text.trim();

    // "自动完成" — auto-complete remaining branches
    if (/^(自动完成|自动|auto)$/i.test(trimmed)) {
      setStreaming(true);
      setInteractiveBranch({ phase: 'auto_completing' });
      addMessage({ role: 'assistant', content: '⚡ 切换到自动模式，AI 将完成剩余所有分支...\n', skillName: 'branchGenerator' });

      // Auto-expand all pending branches
      const autoExpand = async () => {
        let ib2 = useChatStore.getState().orchestrator.interactiveBranch;
        while (ib2.pendingExpansions.length > 0 && ib2.phase === 'auto_completing') {
          const sorted = [...ib2.pendingExpansions].sort((a, b) => a.depth - b.depth);
          const next = sorted[0];
          try {
            const proposals = await callExpandNode(next);
            // In late game, prefer ending proposals
            const depthPercent = next.depth / ib2.maxDepth;
            const pick = (depthPercent >= 0.7 && proposals.find((p: any) => p.isEnding)) || proposals[0];
            if (pick) {
              applyProposal(pick, next);
            } else {
              removePendingExpansion(next.parentNodeId, next.choiceId);
            }
          } catch {
            // Skip failed expansions
            removePendingExpansion(next.parentNodeId, next.choiceId);
          }
          ib2 = useChatStore.getState().orchestrator.interactiveBranch;
          useChatStore.getState().updateLastAssistantMessage(
            `⚡ 自动生成中... 剩余 ${ib2.pendingExpansions.length} 条分支\n\n${formatBranchProgress()}`
          );
        }
        // Done
        setInteractiveBranch({ phase: 'idle', active: false });
        updateSkillStatus('branchGenerator', 'completed');
        useChatStore.getState().updateLastAssistantMessage(
          `🎉 **分支剧情自动生成完成！**\n\n${formatBranchProgress()}\n\n输入"继续"进行下一步。`
        );
        setStreaming(false);
      };
      autoExpand();
      return true;
    }

    // "跳过" / "结局" — force this branch to end
    if (/^(跳过|skip|结局|ending)$/i.test(trimmed)) {
      setStreaming(true);
      const endingProposal = {
        id: 'forced_ending',
        title: '（此线结束）',
        narrationPreview: '',
        direction: '创作者决定在此结束这条分支',
        isEnding: true,
        fullNode: {
          title: `${expansion.choiceText}的结局`,
          narration: `你做出了选择。故事在这里画上了句号。`,
          dialogue: null,
          character: null,
          imagePrompt: 'A closing scene, fade to black, dramatic ending',
          choices: [],
        },
      };
      applyProposal(endingProposal, expansion);
      addMessage({ role: 'assistant', content: `✅ 已将"${expansion.choiceText}"标记为结局。`, skillName: 'branchGenerator' });
      await expandNextBranch();
      return true;
    }

    // Number selection: "1", "2", "3"
    const numMatch = trimmed.match(/^([1-3])\s*([\s\S]*)?$/);
    if (numMatch && ib.proposals.length > 0) {
      const idx = parseInt(numMatch[1]) - 1;
      const proposal = ib.proposals[idx];
      if (!proposal) {
        addMessage({ role: 'assistant', content: `没有方案 ${numMatch[1]}，请选择 1-${ib.proposals.length}。` });
        return true;
      }

      // If there's additional text after the number, it's a modification request
      const modification = numMatch[2]?.trim();
      if (modification && modification.length > 5) {
        // TODO: Send modification to LLM to adjust the proposal
        // For now, just use the proposal as-is
        addMessage({ role: 'assistant', content: `（修改功能开发中，先使用原方案）` });
      }

      setStreaming(true);
      applyProposal(proposal, expansion);
      addMessage({
        role: 'assistant',
        content: `✅ 选择了「${proposal.title}」${proposal.isEnding ? '（结局）' : ''}`,
        skillName: 'branchGenerator',
      });
      await expandNextBranch();
      return true;
    }

    // Free text (>30 chars) — creator writes their own node
    if (trimmed.length > 30) {
      setStreaming(true);
      const customProposal = {
        id: 'custom',
        title: trimmed.slice(0, 20) + (trimmed.length > 20 ? '...' : ''),
        narrationPreview: trimmed.slice(0, 80),
        direction: '创作者自定义内容',
        isEnding: false,
        fullNode: {
          title: trimmed.slice(0, 20),
          narration: trimmed,
          dialogue: null,
          character: null,
          imagePrompt: '',
          choices: [{ text: '继续' }],
        },
      };
      applyProposal(customProposal, expansion);
      addMessage({
        role: 'assistant',
        content: `✅ 已创建自定义节点`,
        skillName: 'branchGenerator',
      });
      await expandNextBranch();
      return true;
    }

    // "重试" — regenerate proposals
    if (/^(重试|retry)$/i.test(trimmed)) {
      setStreaming(true);
      await expandNextBranch();
      return true;
    }

    // Unrecognized — show help
    addMessage({
      role: 'assistant',
      content: `请输入：\n- **数字**（1/2/3）选择方案\n- **长文本**（>30字）自己写节点内容\n- **"跳过"** 将此分支标为结局\n- **"自动完成"** AI 完成剩余所有分支`,
    });
    return true;
  }, [applyProposal, callExpandNode, expandNextBranch, formatBranchProgress, removePendingExpansion, setInteractiveBranch, setStreaming, updateSkillStatus, addMessage]);

  // Run entity extraction with real API
  const runEntityExtraction = useCallback(async () => {
    const style = useChatStore.getState().orchestrator.style;
    const story = useStoryStore.getState().story;
    if (!story) return;

    setStreaming(true);
    setCurrentSkill('entityExtractor');
    updateSkillStatus('entityExtractor', 'running');

    addMessage({
      role: 'assistant',
      content: '👤 正在提取角色、场景、道具等主体信息...\n\n⏳ 分析剧情节点中...',
      skillName: 'entityExtractor',
    });

    try {
      const entities = (await callSkillAPI('entityExtractor', {
        nodes: story.nodes || [],
        style,
      })) as { characters: any[]; scenes: any[]; props: any[] };

      const { setEntities } = useChatStore.getState();
      setEntities(entities);

      addMessage({
        role: 'assistant',
        content: `✅ **主体提取完成！**\n\n- 👤 ${entities.characters?.length || 0} 个角色\n- 🏞️ ${entities.scenes?.length || 0} 个场景\n- 🎭 ${entities.props?.length || 0} 个道具\n\n🖼️ 正在为主体生成参考图片（用于后续画面一致性）...`,
        skillName: 'entityExtractor',
      });

      // Auto-generate entity images for visual consistency
      await runEntityImageGeneration(entities);

      addMessage({
        role: 'assistant',
        content: `✅ **主体参考图生成完成！**\n\n后续生成画面时将自动引用这些参考图，保障角色/场景视觉一致性。\n\n输入"继续"进入分镜生成。`,
        skillName: 'entityExtractor',
        confirmRequired: true,
      });
      updateSkillStatus('entityExtractor', 'completed');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage({
        role: 'assistant',
        content: `⚠️ 主体提取失败: ${errMsg}\n\n输入"重试"重新提取。`,
        skillName: 'entityExtractor',
      });
      updateSkillStatus('entityExtractor', 'idle');
    } finally {
      setStreaming(false);
    }
  }, [addMessage, callSkillAPI, setCurrentSkill, setStreaming, updateSkillStatus]);

  // Generate images for entities (characters, scenes, props)
  const runEntityImageGeneration = useCallback(async (entities: { characters: any[]; scenes: any[]; props: any[] }) => {
    const style = useChatStore.getState().orchestrator.style;
    const stylePrefix = style?.stylePromptPrefix || '';
    const { updateEntityImage, updateLastAssistantMessage } = useChatStore.getState();

    // Collect all entities that need images
    const tasks: { type: 'characters' | 'scenes' | 'props'; id: string; name: string; prompt: string; aspectRatio: string }[] = [];

    for (const c of (entities.characters || [])) {
      if (c.imagePrompt) tasks.push({ type: 'characters', id: c.id, name: c.name || '角色', prompt: `${stylePrefix}${c.imagePrompt}`, aspectRatio: '3:4' });
    }
    for (const s of (entities.scenes || [])) {
      if (s.imagePrompt) tasks.push({ type: 'scenes', id: s.id, name: s.name || '场景', prompt: `${stylePrefix}${s.imagePrompt}`, aspectRatio: '16:9' });
    }
    for (const p of (entities.props || [])) {
      if (p.imagePrompt) tasks.push({ type: 'props', id: p.id, name: p.name || '道具', prompt: `${stylePrefix}${p.imagePrompt}`, aspectRatio: '1:1' });
    }

    if (tasks.length === 0) return;

    let completedCount = 0;
    const totalCount = tasks.length;

    // Process in batches of 3
    for (let i = 0; i < tasks.length; i += 3) {
      const batch = tasks.slice(i, i + 3);
      const batchNames = batch.map((t) => t.name).join('、');
      updateLastAssistantMessage(
        `🖼️ 正在生成参考图 (${completedCount}/${totalCount})...\n\n当前：${batchNames}`
      );

      const results = await Promise.allSettled(
        batch.map(async (task) => {
          const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: task.prompt, aspectRatio: task.aspectRatio }),
          });
          const data = await res.json();
          if (!data.success || !data.taskId) throw new Error(data.error || 'Submit failed');

          // Poll for result (max 15 attempts with backoff)
          let pollDelay = 2000;
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise((r) => setTimeout(r, pollDelay));
            pollDelay = Math.min(pollDelay * 1.3, 5000);
            const pollRes = await fetch(`/api/generate-image?taskId=${data.taskId}`);
            const pollData = await pollRes.json();
            if (pollData.status === 'completed' && pollData.imageUrl) {
              return { ...task, imageUrl: pollData.imageUrl };
            }
            if (pollData.status === 'failed') throw new Error('Generation failed');
          }
          throw new Error('Timeout');
        })
      );

      let failedCount = 0;
      for (const r of results) {
        completedCount++;
        if (r.status === 'fulfilled') {
          const { type, id, imageUrl } = r.value;
          updateEntityImage(type, id, imageUrl);
        } else {
          failedCount++;
          console.warn('[EntityImageGen] failed:', r.reason);
        }
      }

      updateLastAssistantMessage(
        `🖼️ 参考图生成进度：${completedCount}/${totalCount}${failedCount > 0 ? `（${failedCount} 个失败）` : ''}`
      );
    }
  }, []);

  // Run storyboard generation for all nodes
  const runStoryboardGeneration = useCallback(async () => {
    const style = useChatStore.getState().orchestrator.style;
    const entities = useChatStore.getState().orchestrator.entities;
    const story = useStoryStore.getState().story;
    if (!story || !entities) return;

    setStreaming(true);
    setCurrentSkill('storyboardGenerator');
    updateSkillStatus('storyboardGenerator', 'running');

    addMessage({
      role: 'assistant',
      content: `🎬 正在为 ${(story.nodes || []).length} 个节点生成分镜...\n\n⏳ 逐个生成图片提示词中...`,
      skillName: 'storyboardGenerator',
    });

    try {
      let successCount = 0;
      // Process nodes in batches of 3 to avoid overwhelming the API
      const storyNodes = story.nodes || [];
      for (let i = 0; i < storyNodes.length; i += 3) {
        const batch = storyNodes.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((node) =>
            callSkillAPI('storyboardGenerator', { node, entities, style })
          )
        );

        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            const sb = (results[j] as PromiseFulfilledResult<any>).value;
            const nodeId = batch[j].id;
            const { updateNode } = useStoryStore.getState();

            // Build frames from storyboard output
            const frames = (sb.frames || []).map((f: any) => ({
              id: uuid(),
              narrationSegment: f.narrationSegment || '',
              imagePrompt: f.imagePrompt || '',
              imageUrl: null,
              entityRefs: f.entityRefs || [],
              duration: f.duration || 3,
            }));

            updateNode(nodeId, {
              imagePrompt: sb.imagePrompt || frames[0]?.imagePrompt || batch[j].data.imagePrompt,
              narration: sb.narration || batch[j].data.narration,
              frames,
            });
            successCount++;
          }
        }
      }

      addMessage({
        role: 'assistant',
        content: `✅ **分镜生成完成！**\n\n成功处理 ${successCount}/${storyNodes.length} 个节点的分镜\n每个节点已拆分为多个画面帧，可在右侧面板查看和编辑。\n\n输入"继续"进入配音生成，或点击节点在右侧面板逐帧生成图片。`,
        skillName: 'storyboardGenerator',
        confirmRequired: true,
      });
      updateSkillStatus('storyboardGenerator', 'completed');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage({
        role: 'assistant',
        content: `⚠️ 分镜生成失败: ${errMsg}`,
        skillName: 'storyboardGenerator',
      });
      updateSkillStatus('storyboardGenerator', 'idle');
    } finally {
      setStreaming(false);
    }
  }, [addMessage, callSkillAPI, setCurrentSkill, setStreaming, updateSkillStatus]);

  // Run voice generation
  const runVoiceGeneration = useCallback(async () => {
    const entities = useChatStore.getState().orchestrator.entities;
    const story = useStoryStore.getState().story;
    if (!story || !entities) return;

    setStreaming(true);
    setCurrentSkill('voiceGenerator');
    updateSkillStatus('voiceGenerator', 'running');

    addMessage({
      role: 'assistant',
      content: '🎙️ 正在为每个节点生成配音分段...\n\n⏳ 分配旁白、角色语音中...',
      skillName: 'voiceGenerator',
    });

    try {
      let successCount = 0;
      const voiceNodes = story.nodes || [];
      for (let i = 0; i < voiceNodes.length; i += 3) {
        const batch = voiceNodes.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((node) =>
            callSkillAPI('voiceGenerator', {
              storyboard: {
                nodeId: node.id,
                narration: node.data.narration,
                dialogue: node.data.dialogue,
                character: node.data.character,
              },
              entities,
            })
          )
        );

        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            const voice = (results[j] as PromiseFulfilledResult<any>).value;
            const nodeId = batch[j].id;
            const { updateNode } = useStoryStore.getState();
            updateNode(nodeId, {
              voiceSegments: voice.segments || voice.voiceSegments || [],
            });
            successCount++;
          }
        }
      }

      // Phase 2: Generate TTS audio for each voice segment (with correct voiceType)
      addMessage({
        role: 'assistant',
        content: `✅ **配音分段完成！** 成功处理 ${successCount}/${voiceNodes.length} 个节点\n\n🔊 正在按角色音色生成 TTS 语音...`,
        skillName: 'voiceGenerator',
      });

      const latestStory = useStoryStore.getState().story;
      let ttsSuccessCount = 0;
      let ttsSegmentTotal = 0;
      if (latestStory) {
        const latestNodes = latestStory.nodes || [];
        for (let i = 0; i < latestNodes.length; i += 2) {
          const batch = latestNodes.slice(i, i + 2);
          await Promise.allSettled(
            batch.map(async (node) => {
              const segments = node.data.voiceSegments || [];
              if (segments.length === 0) return;
              ttsSegmentTotal += segments.length;

              // Generate TTS for each segment with its own voiceType
              const updatedSegments = [...segments];
              for (let si = 0; si < segments.length; si++) {
                const seg = segments[si];
                if (!seg.text.trim()) continue;
                try {
                  const res = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      text: seg.text,
                      voiceType: seg.voiceType || 'narrator',
                      speed: seg.speed || 1.0,
                      nodeId: `${node.id}_seg${si}`,
                    }),
                  });
                  const data = await res.json();
                  if (data.success && data.audioUrl) {
                    updatedSegments[si] = { ...updatedSegments[si], audioUrl: data.audioUrl };
                    ttsSuccessCount++;
                  }
                } catch {
                  // skip failed segment
                }
              }

              // Update node with segments that now have audioUrls
              const { updateNode: updateNodeStore } = useStoryStore.getState();
              // Also set the first segment's audioUrl as the node's main audioUrl for backward compat
              const firstAudioUrl = updatedSegments.find((s) => s.audioUrl)?.audioUrl || null;
              updateNodeStore(node.id, {
                voiceSegments: updatedSegments,
                audioUrl: firstAudioUrl,
              });
            })
          );
        }
      }

      addMessage({
        role: 'assistant',
        content: `✅ **配音生成完成！**\n\n成功处理 ${successCount}/${voiceNodes.length} 个节点配音分段\n🔊 TTS 语音：${ttsSuccessCount}/${ttsSegmentTotal} 个语音片段（按角色音色生成）\n\n🎉 **所有创作流程已完成！**\n\n你可以：\n1. 点击节点编辑细节\n2. 点击"生成图片"为节点生成画面\n3. 点击右上角"预览"查看整体效果\n4. 满意后点击"发布"上线你的互动影游`,
        skillName: 'voiceGenerator',
      });
      updateSkillStatus('voiceGenerator', 'completed');
      setCurrentSkill(null);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage({
        role: 'assistant',
        content: `⚠️ 配音生成失败: ${errMsg}`,
        skillName: 'voiceGenerator',
      });
      updateSkillStatus('voiceGenerator', 'idle');
    } finally {
      setStreaming(false);
    }
  }, [addMessage, callSkillAPI, setCurrentSkill, setStreaming, updateSkillStatus]);

  // --- Intent-based handlers ---

  const runSkillByName = useCallback((skill: SkillName) => {
    switch (skill) {
      case 'outlineGenerator': {
        const desc = orchestrator.storyDescription;
        const style = orchestrator.style;
        if (desc && style) runOutlineGeneration(desc, style);
        break;
      }
      case 'branchGenerator':
        runBranchGeneration();
        break;
      case 'entityExtractor':
        runEntityExtraction();
        break;
      case 'storyboardGenerator':
        runStoryboardGeneration();
        break;
      case 'voiceGenerator':
        runVoiceGeneration();
        break;
    }
  }, [orchestrator.storyDescription, orchestrator.style, runOutlineGeneration, runBranchGeneration, runEntityExtraction, runStoryboardGeneration, runVoiceGeneration]);

  // [Pipeline functions removed — all handled by ReAct tools]
  /* --- DEAD PIPELINE CODE START (kept for reference, wrapped in false block) ---
  const getNextPipelineAction = useCallback(() => {
    const currentSkill = orchestrator.currentSkill;
    const skills = orchestrator.skills;
    const story = useStoryStore.getState().story;

    // No story at all → need to start fresh
    if (!story || (story.nodes || []).length === 0) {
      if (!currentSkill || currentSkill === 'styleConfirm') return null; // handled separately
    }

    // If current skill is outlineGenerator, prompt for mode selection instead of auto-advancing
    if (currentSkill === 'outlineGenerator') {
      // Don't auto-advance — show mode selection prompt
      addMessage({
        role: 'assistant',
        content: '请选择创作方式：\n\n**1. 🤝 共创模式** — 逐节点对话，你来把控每个剧情走向\n**2. ⚡ 快速模式** — AI 一次性生成完整分支树\n\n输入 **1** 或 **2** 选择（推荐共创模式）',
      });
      return null; // Don't auto-run anything
    }

    // Find the next incomplete skill after current
    if (currentSkill) {
      const idx = SKILL_PIPELINE.indexOf(currentSkill);
      if (idx >= 0 && idx < SKILL_PIPELINE.length - 1) {
        return SKILL_PIPELINE[idx + 1];
      }
    }

    // currentSkill is null → find first non-completed skill
    for (const sk of SKILL_PIPELINE) {
      if (sk === 'styleConfirm') continue;
      const state = skills.find((s) => s.name === sk);
      if (state && state.status !== 'completed') return sk;
    }

    return null; // all done
  }, [orchestrator.currentSkill, orchestrator.skills, updateSkillStatus, addMessage]);

  const handleContinuePipeline = useCallback(() => {
    const story = useStoryStore.getState().story;
    const currentSkill = orchestrator.currentSkill;

    // Special: no story yet → first message flow
    if ((!story || (story.nodes || []).length === 0) && !currentSkill) {
      return false; // signal that caller should handle as new story
    }

    const nextSkill = getNextPipelineAction();
    if (nextSkill) {
      runSkillByName(nextSkill);
    } else {
      addMessage({
        role: 'assistant',
        content: '所有创作流程已完成！你可以：\n1. 点击节点编辑细节\n2. 点击"生成图片"生成画面\n3. 点击右上角"预览"查看效果',
      });
    }
    return true;
  }, [orchestrator.currentSkill, getNextPipelineAction, runSkillByName, addMessage]);

  const handleRetryCurrent = useCallback(() => {
    const currentSkill = orchestrator.currentSkill;
    if (currentSkill && currentSkill !== 'styleConfirm') {
      runSkillByName(currentSkill);
      return;
    }
    // Find last completed skill to retry
    for (let i = SKILL_PIPELINE.length - 1; i >= 0; i--) {
      const sk = SKILL_PIPELINE[i];
      const state = orchestrator.skills.find((s) => s.name === sk);
      if (state && state.status === 'completed') {
        updateSkillStatus(sk, 'idle');
        setCurrentSkill(sk);
        runSkillByName(sk);
        return;
      }
    }
    addMessage({ role: 'assistant', content: '当前没有可以重试的步骤。' });
  }, [orchestrator.currentSkill, orchestrator.skills, runSkillByName, updateSkillStatus, setCurrentSkill, addMessage]);

  const handleRerunStep = useCallback((targetSkill: SkillName) => {
    const idx = SKILL_PIPELINE.indexOf(targetSkill);
    if (idx < 0) return;

    // Reset target and all downstream skills
    for (let i = idx; i < SKILL_PIPELINE.length; i++) {
      updateSkillStatus(SKILL_PIPELINE[i], 'idle');
    }
    setCurrentSkill(targetSkill);

    addMessage({
      role: 'assistant',
      content: `正在重新生成「${skillLabels[targetSkill]}」...`,
      skillName: targetSkill,
    });

    runSkillByName(targetSkill);
  }, [updateSkillStatus, setCurrentSkill, addMessage, runSkillByName]);

  const handleEditNode = useCallback((params: { nodeIndex?: number; field?: string; newValue?: string }) => {
    const story = useStoryStore.getState().story;
    if (!story || !(story.nodes || []).length) {
      addMessage({ role: 'assistant', content: '当前还没有故事节点，请先生成故事。' });
      return;
    }

    const { nodeIndex, field, newValue } = params;
    if (!nodeIndex || !field || !newValue) {
      addMessage({ role: 'assistant', content: '请指定要修改的节点编号、字段和新内容。\n\n例如："修改第3个节点的旁白为夜幕降临，城市灯火通明"' });
      return;
    }

    const node = (story.nodes || [])[nodeIndex - 1];
    if (!node) {
      addMessage({ role: 'assistant', content: `节点 ${nodeIndex} 不存在，当前共 ${(story.nodes || []).length} 个节点。` });
      return;
    }

    const validFields: Record<string, string> = {
      narration: '旁白',
      title: '标题',
      dialogue: '对话',
      character: '角色',
    };

    if (!validFields[field]) {
      addMessage({ role: 'assistant', content: `不支持修改「${field}」字段。支持的字段：${Object.values(validFields).join('、')}` });
      return;
    }

    const { updateNode } = useStoryStore.getState();
    updateNode(node.id, { [field]: newValue });
    addMessage({
      role: 'assistant',
      content: `已将节点 ${nodeIndex}「${node.data.title}」的${validFields[field]}修改为：\n\n> ${newValue.length > 100 ? newValue.slice(0, 100) + '...' : newValue}`,
    });
  }, [addMessage]);

  const handleGeneralChat = useCallback(async (text: string) => {
    setStreaming(true);
    try {
      const story = useStoryStore.getState().story;
      const storyContext = story ? [
        `故事标题: ${story.title}`,
        `节点数: ${(story.nodes || []).length}`,
        `结局数: ${(story.nodes || []).filter((n) => n.type === 'ending').length}`,
        `连线数: ${(story.edges || []).length}`,
        orchestrator.style ? `风格: ${orchestrator.style.styleName}` : '',
        orchestrator.outline ? `主题: ${orchestrator.outline.theme}` : '',
        orchestrator.entities ? `角色: ${orchestrator.entities.characters.map((c: any) => c.name).join('、')}` : '',
        `当前步骤: ${orchestrator.currentSkill ? skillLabels[orchestrator.currentSkill] : '全部完成'}`,
        (story.nodes || []).length > 0 ? `节点列表:\n${(story.nodes || []).map((n, i) => `${i + 1}. [${n.type}] ${n.data.title}`).join('\n')}` : '',
      ].filter(Boolean).join('\n') : '暂无故事数据';

      const res = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill: 'chat',
          input: { question: text, storyContext },
        }),
      });
      const data = await res.json();
      if (data.error) {
        addMessage({ role: 'assistant', content: `抱歉，我遇到了一些问题：${data.error}` });
      } else {
        addMessage({ role: 'assistant', content: data.reply || '我不太理解你的意思，请再说一遍。' });
      }
    } catch (err) {
      addMessage({ role: 'assistant', content: '抱歉，聊天服务暂时不可用，请稍后再试。' });
    } finally {
      setStreaming(false);
    }
  }, [addMessage, setStreaming, orchestrator]);

  const classifyIntent = useCallback(async (text: string): Promise<IntentResult> => {
    try {
      const story = useStoryStore.getState().story;
      const completedSkills = orchestrator.skills
        .filter((s) => s.status === 'completed')
        .map((s) => s.name);

      const res = await fetch('/api/classify-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: text,
          currentSkill: orchestrator.currentSkill,
          completedSkills,
          hasStory: !!(story && (story.nodes || []).length > 0),
          nodeCount: story?.nodes?.length || 0,
        }),
      });
      const data = await res.json();
      return { intent: data.intent || 'general_chat', params: data.params || {} };
    } catch {
      return { intent: 'general_chat', params: {} };
    }
  }, [orchestrator]);

  // Helper: start story creation flow
  const startStoryCreation = useCallback((description: string, clearChat = false, userText?: string, depth?: number) => {
    if (clearChat) {
      useChatStore.getState().clearMessages();
      // Re-add user's message after clearing so it's visible in chat history
      if (userText) {
        addMessage({ role: 'user', content: userText });
      }
    }
    requestedDepthRef.current = depth;
    setStoryDescription(description);
    initStory('新影游', description);
    setStreaming(true);
    setCurrentSkill('styleConfirm');
    updateSkillStatus('styleConfirm', 'running');
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content: `好的，我来帮你创作这个故事：\n\n> ${description}${depth ? `\n> 层级深度：${depth} 层` : ''}\n\n首先选择一个画面风格：`,
        skillName: 'styleConfirm',
        confirmRequired: true,
      });
      updateSkillStatus('styleConfirm', 'waiting_confirm');
      setStreaming(false);
    }, 300);
  }, [setStoryDescription, initStory, setStreaming, setCurrentSkill, updateSkillStatus, addMessage]);
  --- DEAD PIPELINE CODE END */

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');

    // ========== Meta actions (mode-independent) ==========
    const lowerText = text.trim().toLowerCase();
    if (/^(清空故事|清空|重新开始|从头开始|重头开始|新故事|创建新故事)$/.test(lowerText)) {
      addMessage({ role: 'user', content: text });
      // Clear everything: nodes, edges, orchestrator, messages
      useStoryStore.getState().setNodesAndEdges([], []);
      useChatStore.getState().clearMessages();
      addMessage({
        role: 'assistant',
        content: '已清空所有内容，可以重新开始。告诉我你想创作什么故事吧！',
      });
      return;
    }

    // ========== ReAct Mode (only mode) ==========
    addMessage({ role: 'user', content: text });
    // Resume if loop has existing progress — don't reset completed skills
    const skills = useChatStore.getState().orchestrator.skills;
    const hasExistingProgress = skills.some(s => s.status !== 'idle');
    const loopStatus = reactLoop.status;
    const isRunning = loopStatus === 'thinking' || loopStatus === 'acting';

    console.log(`[handleSend] loopStatus=${loopStatus}, hasExistingProgress=${hasExistingProgress}, skills=${skills.map(s => `${s.name}:${s.status}`).join(',')}`);

    if (hasExistingProgress && !isRunning) {
      // Continue existing conversation — don't reset skills
      console.log('[handleSend] → resumeLoop');
      reactLoop.resumeLoop(text);
    } else if (!isRunning) {
      // Fresh start — no existing progress
      const story = useStoryStore.getState().story;
      const contentNodes = story ? (story.nodes || []).filter((n: any) => n.type !== 'story_config') : [];
      const hasNodes = contentNodes.length > 0;
      const creationComplete = hasNodes && contentNodes.every(
        (n: any) => (n.data.frames?.length > 0) && (n.data.voiceSegments?.length > 0)
      );
      const { orchestrator: orch } = useChatStore.getState();
      if (!orch.storyDescription && !hasNodes) {
        useChatStore.getState().setStoryDescription(text);
      }
      reactLoop.startLoop(text, creationComplete ? 'edit' : 'create');
    }
  }, [
    input,
    isStreaming,
    addMessage,
    reactLoop,
  ]);

  // Style button click handler (used to avoid code duplication)
  const handleStyleSelect = useCallback(
    (style: (typeof PRESET_STYLES)[number], msgId: string) => {
      confirmSkill(msgId);
      addMessage({ role: 'user', content: style.styleName });
      setSelectedStyle(style);
      setStyle(style);
      updateSkillStatus('styleConfirm', 'completed');
      runOutlineGeneration(orchestrator.storyDescription, style);
    },
    [addMessage, confirmSkill, orchestrator.storyDescription, runOutlineGeneration, setSelectedStyle, setStyle, updateSkillStatus]
  );

  if (!agentPanelOpen) return null;

  return (
    <div
      className="fixed top-14 left-0 bottom-0 w-80 flex flex-col z-40"
      style={{
        background: 'rgba(18, 18, 26, 0.95)',
        borderRight: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        animation: 'slideIn 0.2s ease-out',
      }}
    >
      {/* Header: Mode toggle + Step progress */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        {/* Row 1: Progress */}
        <div className="flex items-center justify-end px-3 py-1.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {orchestrator.skills.filter(s => s.status === 'completed').length}/{orchestrator.skills.length} 完成
          </span>
        </div>

        {/* Row 2: Step progress */}
        <div className="flex items-center justify-between px-2 pb-2">
          {orchestrator.skills.map((skill, i) => {
            const isActive = skill.status === 'running';
            const isDone = skill.status === 'completed';
            const isError = skill.status === 'error';
            return (
              <Fragment key={skill.name}>
                {i > 0 && (
                  <div
                    className="flex-1 h-px mx-0.5"
                    style={{ background: isDone || orchestrator.skills[i - 1]?.status === 'completed' ? 'var(--success)' : 'var(--border)' }}
                  />
                )}
                <div className="flex flex-col items-center gap-0.5 shrink-0" title={skillLabels[skill.name]}>
                  <div
                    className="w-6 h-6 flex items-center justify-center rounded-md text-[11px] transition-all"
                    style={{
                      background: isActive ? 'var(--accent-dim)' : isDone ? 'rgba(52,211,153,0.1)' : 'transparent',
                      color: isDone ? 'var(--success)' : isActive ? 'var(--accent)' : isError ? 'var(--danger)' : 'var(--text-muted)',
                      border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'rgba(52,211,153,0.3)' : 'transparent'}`,
                    }}
                  >
                    {isDone ? '✓' : (
                      <span className={isActive ? 'animate-pulse' : ''}>
                        {skillIcons[skill.name]}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[9px] leading-none"
                    style={{ color: isDone ? 'var(--success)' : isActive ? 'var(--accent)' : isError ? 'var(--danger)' : 'var(--text-muted)' }}
                  >
                    {skillShortLabels[skill.name]}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => {
          const isReplyAnchor = msg.role === 'assistant' && (idx === 0 || messages[idx - 1]?.role === 'user');
          return (
            <Fragment key={msg.id}>
              {isReplyAnchor && <div ref={newReplyAnchorRef} className="h-0" />}
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words"
                  style={{
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                  }}
                >
                  {msg.reactThought && (
                    <details className="mb-1">
                      <summary className="text-[10px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        🧠 思考过程
                      </summary>
                      <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {msg.reactThought}
                      </p>
                    </details>
                  )}
                  {msg.content}
                  {msg.skillName === 'styleConfirm' && msg.confirmRequired && !msg.confirmed && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {PRESET_STYLES.map((style) => (
                        <button
                          key={style.styleId}
                          onClick={() => handleStyleSelect(style, msg.id)}
                          className="px-2 py-1 rounded-lg text-xs transition-colors hover:brightness-110"
                          style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {style.styleName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}

        {/* ReAct status indicator */}
        {(reactLoop.status === 'thinking' || reactLoop.status === 'acting') && (
          <div className="flex justify-start">
            <div
              className="rounded-xl px-3 py-2 text-sm"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
            >
              {reactLoop.status === 'thinking' && (
                <div>
                  <span className="animate-pulse">🧠 推理中...</span>
                  {reactLoop.currentThought && (
                    <p className="mt-1 text-[10px] opacity-60 leading-relaxed">{reactLoop.currentThought}</p>
                  )}
                </div>
              )}
              {reactLoop.status === 'acting' && (
                <span className="animate-pulse">⚡ 执行: {reactLoop.currentTool}...</span>
              )}
            </div>
          </div>
        )}

        {/* Pipeline streaming indicator removed */}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            className="flex-1 px-3 py-2 rounded-lg text-sm resize-none"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              maxHeight: 120,
            }}
            placeholder="描述你的故事..."
          />
          {(reactLoop.status === 'thinking' || reactLoop.status === 'acting') ? (
            <button
              onClick={reactLoop.abort}
              className="p-2 rounded-lg transition-colors"
              style={{ background: 'var(--danger, #ef4444)', color: 'white' }}
              title="停止推理"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="p-2 rounded-lg transition-colors disabled:opacity-30"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
