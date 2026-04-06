import { NextRequest, NextResponse } from 'next/server';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';
import { moderateContent, sanitizeOutput } from '@/lib/safety';
import { synthesizeSpeech } from '@/lib/minimax-tts';
import { uploadAudio } from '@/lib/oss';
import { VOICE_SYSTEM_PROMPT, VOICE_USER_PROMPT } from '@/lib/agent/prompts/voice';
import { syncFramesFromVoice } from '@/types/story';
import type { StoryNode, VoiceSegment, Frame } from '@/types/story';

/**
 * Branch Prefetch API
 *
 * Called in background while the player watches/listens to the current node.
 * Generates full content (storyboard, voice, TTS) for stub nodes,
 * and recursively generates LLM decisions for new branch choices.
 *
 * This creates a "lookahead" effect: by the time the player picks a choice,
 * the next node is already fully generated.
 */

const BRANCH_CONTINUE_PROMPT = `你是一个互动影游的剧情推理引擎。你正在为一个分支路径生成下一步剧情。

## 任务
根据当前分支节点的标题和上下文，生成该节点的完整叙述和后续选项。

## 输出格式 (JSON)
{
  "narration": "该节点的叙述文本（100-200字，第二人称'你'视角）",
  "title": "节点标题",
  "choices": [
    { "text": "选项文本", "type": "branch" },
    { "text": "选项文本", "type": "converge", "converge_narration": "50-100字过渡叙述" },
    { "text": "选项文本", "type": "ending" }
  ]
}

## 要求
- narration 使用第二人称"你"视角
- 叙述要承接上一步的选择，有因果关系
- choices 生成2-3个选项：
  - branch（优先）: 继续探索新路径，有完整后续故事
  - converge: 通过过渡剧情自然回到主线，**必须附带 converge_narration**
  - ending: 走向新结局（谨慎使用）
- **所有选项都必须有后续剧情，不能直接跳回主线**
- 选项文字用简洁动作短语，不要加"我"字开头
- 推荐组合: 1个 branch + 1个 converge
- 分支深度0时，以 branch 为主，可再探索一步
- 分支深度1+时，推荐 2个 converge + 1个 ending(可选)，自然收束回主线`;

const BRIDGE_PROMPT = `你是一个互动影游的剧情过渡引擎。你的任务是为支线剧情生成**回归主线的过渡叙述**。

## 核心目标
玩家正在支线上，需要通过自然的剧情过渡回到主线的某个节点。你要判断：
1. 当前支线的情境（地点/事件/角色状态）与目标主线节点的情境差距有多大？
2. 能否用一段叙述自然地过渡过去？

## 判断标准
- **可以直接过渡（canConnect: true）**：当前场景和目标场景在空间或逻辑上有关联，用100-200字就能讲通
  例：支线在"废弃仓库搜集线索"，目标是"回到警局汇报" → 可以过渡
- **需要更多铺垫（canConnect: false）**：场景跨度太大，无法一步讲通，需要中间步骤
  例：支线在"深山逃亡中"，目标是"参加公司晚宴" → 需要先下山、回城等中间步骤

## 输出格式 (JSON)
{
  "canConnect": true/false,
  "narration": "过渡叙述（100-200字，第二人称'你'视角）",
  "title": "节点标题",
  "nextBridgeHint": "仅 canConnect=false 时需要：下一步过渡的方向（20字以内）"
}

## 写作要求
- **canConnect=true 时**：narration 前半段描述支线经历的影响，后半段自然过渡到目标场景的情境，让读完后直接进入主线节点不会觉得突兀
- **canConnect=false 时**：narration 描述朝目标方向推进一步的剧情（不要硬跳），nextBridgeHint 给出下一步过渡的方向
- 禁止使用 meta 描述（如"故事回到了主线"、"命运的齿轮"等套话）
- 要有具体的画面感：人物在做什么、看到什么、感受到什么`;

/** Generate full content for a single node (storyboard + voice in parallel, then TTS) */
async function generateNodeContent(
  node: StoryNode,
  entities: any,
  style: any,
  defaultVoice: string,
): Promise<{ frames: Frame[]; voiceSegments: VoiceSegment[] }> {
  const nodeId = node.id;

  const narrationText = node.data.narration || '';

  // Skip LLM calls if no narration content — use direct fallback
  if (!narrationText) {
    return {
      frames: [{ id: `frame_${nodeId}_0`, narrationSegment: '', imagePrompt: `${style?.stylePromptPrefix || ''} dramatic scene, cinematic lighting`, imageUrl: null, duration: 5 }],
      voiceSegments: [],
    };
  }

  // Skip storyboard LLM — images are not generated on player side (imageUrl always null).
  // Only generate voice segments via LLM.
  let frames: Frame[] = [{ id: `frame_${nodeId}_0`, narrationSegment: narrationText, imagePrompt: `${style?.stylePromptPrefix || ''} dramatic scene, cinematic lighting`, imageUrl: null, duration: 5 }];

  const voiceResult = await callLLM({
    systemPrompt: VOICE_SYSTEM_PROMPT,
    userMessage: VOICE_USER_PROMPT(
      JSON.stringify({ nodeId, narration: narrationText, dialogue: node.data.dialogue, character: node.data.character }),
      JSON.stringify(entities || {}),
    ),
    temperature: 0.7,
    maxTokens: 4096,
  }).then((r) => {
    const voiceData = parseJsonFromResponse(r);
    const narratorVoice = defaultVoice || 'narrator';
    return (voiceData.voiceSegments || voiceData.segments || []).map((s: any, i: number) => ({
      id: `seg_${nodeId}_${i}`,
      text: s.text || '',
      speaker: s.speaker || 'narrator',
      voiceType: (s.speaker === 'narrator' || s.voiceType === 'narrator') ? narratorVoice : (s.voiceType || 'narrator'),
      emotion: s.emotion || '',
      speed: s.speed || 1.0,
      audioUrl: null,
    }));
  }).catch(() => null);

  let voiceSegments: VoiceSegment[] = voiceResult
    ? voiceResult.filter((s: VoiceSegment) => s.text.trim())
    : [{ id: `seg_${nodeId}_0`, text: narrationText, speaker: 'narrator', voiceType: (defaultVoice as any) || 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null }];
  // Ensure at least one segment
  if (voiceSegments.length === 0) {
    voiceSegments = [{ id: `seg_${nodeId}_0`, text: narrationText, speaker: 'narrator', voiceType: (defaultVoice as any) || 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null }];
  }

  // TTS generation (always)
  await Promise.allSettled(
    voiceSegments.map(async (seg, i) => {
      try {
        const cleanedText = seg.text
          .replace(/[（(][^）)]*[画外音旁白场景切换音效背景][^）)]*[）)]/g, '')
          .replace(/[\[【][^\]】]*[\]】]/g, '')
          .replace(/\*[^*]+\*/g, '')
          .replace(/——/g, '，')
          .trim();
        if (!cleanedText) return;
        const audioBuffer = await synthesizeSpeech({
          text: cleanedText.slice(0, 10000),
          voiceType: (seg.voiceType as any) || 'narrator',
          speed: seg.speed || 1.0,
        });
        const audioUrl = await uploadAudio(audioBuffer, `${nodeId}_seg${i}_${Date.now()}.mp3`);
        voiceSegments[i] = { ...voiceSegments[i], audioUrl };
      } catch { /* skip */ }
    }),
  );

  if (frames.length > 0) {
    frames = syncFramesFromVoice(frames, voiceSegments);
  }

  return { frames, voiceSegments };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    storyId,
    nodes,          // stub nodes to generate content for
    worldView,
    mainPlotNodeIds,
    mainPlotNodes,  // with title/narration context
    style,
    entities,
    defaultVoice,
    playerObjective,
    branchDepth,    // current branch depth (for convergence pressure)
    convergenceTarget,
    convergenceTargetContext, // { title, narration } of the target node
  } = body;

  if (!nodes || nodes.length === 0) {
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] });
  }

  const maxDepth = branchDepth || 0;

  const MAX_BRIDGE_DEPTH = 3; // Max bridge steps before forcing mainline connection

  /** Process a converge_bridge stub: generate transition narration, decide if ready to connect */
  async function processBridgeNode(stubNode: any): Promise<{
    completed: { nodeId: string; data: Partial<StoryNode['data']> };
    extraNodes: StoryNode[];
  }> {
    const node: StoryNode = {
      id: stubNode.id,
      type: 'ai_generated',
      position: { x: 0, y: 0 },
      data: { ...stubNode.data },
    };
    const nodeExtraNodes: StoryNode[] = [];
    const meta = node.data.metadata || {};
    const bridgeTarget = meta.convergenceTarget || convergenceTarget;
    const bridgeDepth = (meta.bridgeDepth ?? 0) as number;
    const hint = meta.convergenceHint || '';

    // Find target node context from mainPlotNodes
    const targetNode = (mainPlotNodes || []).find((n: any) => n.id === bridgeTarget);
    const targetTitle = targetNode?.title || convergenceTargetContext?.title || '未知';
    const targetNarration = targetNode?.narration || convergenceTargetContext?.narration || '未知';

    // If we've reached max bridge depth, force connection
    const forceConnect = bridgeDepth >= MAX_BRIDGE_DEPTH;

    try {
      const bridgeResponse = await callLLM({
        systemPrompt: BRIDGE_PROMPT,
        userMessage: [
          `## 故事世界观`,
          worldView || '(无)',
          ``,
          ...(playerObjective ? [
            `## 玩家目标`,
            `目标：${playerObjective.primary}`,
            `衡量维度：${playerObjective.measurement}`,
            ``,
          ] : []),
          `## 当前支线节点`,
          `标题: ${node.data.title}`,
          ``,
          `## 此前的支线剧情经过（你的过渡叙述必须承接这些内容）`,
          meta.storyContext || '(无)',
          hint ? `\n过渡方向提示: ${hint}` : '',
          ``,
          `## 目标主线节点（需要过渡到这里）`,
          `标题: ${targetTitle}`,
          `剧情: ${targetNarration}`,
          ``,
          `## 当前桥接步数: ${bridgeDepth}/${MAX_BRIDGE_DEPTH}`,
          forceConnect ? `⚠️ 已达到最大桥接步数，必须在本节点完成过渡（canConnect 必须为 true）` : '',
          ``,
          `请判断能否自然过渡到目标节点，并生成过渡叙述。`,
        ].filter(Boolean).join('\n'),
        temperature: 0.7,
        maxTokens: 2048,
      });
      const bridge = parseJsonFromResponse(bridgeResponse);

      if (bridge.narration) {
        const modResult = moderateContent(bridge.narration);
        if (!modResult.safe) bridge.narration = sanitizeOutput(bridge.narration);
      }

      node.data.narration = bridge.narration || `你决定${node.data.title}。事态在不知不觉中发生了变化...`;
      if (bridge.title) node.data.title = bridge.title;

      const canConnect = forceConnect || bridge.canConnect !== false;

      if (canConnect) {
        // Ready to connect to mainline — single "继续" choice
        node.data.choices = [{
          id: `choice_${node.id}_main`,
          text: `继续`,
          targetNodeId: bridgeTarget,
        }];
      } else {
        // Need more bridging — create next bridge stub with accumulated context
        const nextBridgeId = `ai_bridge_${Date.now()}_${node.id}`;
        const nextHint = bridge.nextBridgeHint || '';
        const updatedBridgeContext = `${meta.storyContext || ''}\n[过渡] ${(node.data.narration || '').slice(0, 200)}`.slice(-800);
        nodeExtraNodes.push({
          id: nextBridgeId, type: 'ai_generated', position: { x: 0, y: 0 },
          data: {
            title: nextHint || '继续前进',
            narration: '', // Stub — next prefetch round will fill
            dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
            choices: [{ id: `choice_${nextBridgeId}_main`, text: '继续', targetNodeId: bridgeTarget }], // Fallback
            allowCustomInput: false, depth: 0, voiceSegments: [], frames: [],
            metadata: {
              tags: ['ai_generated', 'converge_bridge'],
              storyContext: updatedBridgeContext,
              convergenceTarget: bridgeTarget,
              convergenceHint: nextHint,
              bridgeDepth: bridgeDepth + 1,
            },
          },
        });
        node.data.choices = [{
          id: `choice_${node.id}_next`,
          text: nextHint || '继续',
          targetNodeId: nextBridgeId,
        }];
      }
    } catch {
      // On failure, keep fallback choice pointing to mainline
    }

    // Generate voice + TTS
    const { frames, voiceSegments } = await generateNodeContent(node, entities, style, defaultVoice || 'narrator');

    return {
      completed: {
        nodeId: node.id,
        data: { narration: node.data.narration, title: node.data.title, choices: node.data.choices, frames, voiceSegments },
      },
      extraNodes: nodeExtraNodes,
    };
  }

  /** Process a single stub node: LLM narration → choices → storyboard → voice → TTS */
  async function processNode(stubNode: any) {
    // Route converge_bridge nodes to dedicated handler
    const tags = stubNode.data?.metadata?.tags || [];
    if (tags.includes('converge_bridge')) {
      return processBridgeNode(stubNode);
    }

    const node: StoryNode = {
      id: stubNode.id,
      type: stubNode.type || 'ai_generated',
      position: { x: 0, y: 0 },
      data: { ...stubNode.data },
    };
    const nodeExtraNodes: StoryNode[] = [];

    // Step 1: If the node has no real narration, generate via LLM
    const isStub = !node.data.narration;
    if (isStub) {
      try {
        const decisionResponse = await callLLM({
          systemPrompt: BRANCH_CONTINUE_PROMPT,
          userMessage: node.type === 'ending'
            ? `## 故事世界观\n${worldView}${playerObjective ? `\n\n## 玩家目标\n目标：${playerObjective.primary}\n衡量维度：${playerObjective.measurement}` : ''}\n\n## 结局节点\n标题: ${node.data.title}\n\n## 此前的支线剧情经过\n${node.data.metadata?.storyContext || '(无)'}\n\n请为这个结局生成一段完整的叙述（100-200字），不需要选项。用第二人称"你"视角，给故事一个有感染力的收尾。叙述必须承接上面的支线剧情，体现玩家策略选择的后果。输出JSON: {"narration": "...", "title": "..."}`
            : `## 故事世界观\n${worldView}${playerObjective ? `\n\n## 玩家目标\n目标：${playerObjective.primary}\n衡量维度：${playerObjective.measurement}` : ''}\n\n## 当前分支节点\n标题: ${node.data.title}\n\n## 此前的支线剧情经过（你的叙述必须承接这些内容）\n${node.data.metadata?.storyContext || '(无)'}\n\n## 主线节点ID列表\n${(mainPlotNodeIds || []).join(', ')}\n\n## 收束目标节点\nID: ${convergenceTarget}${convergenceTargetContext ? `\n标题: ${convergenceTargetContext.title || '未知'}\n剧情: ${convergenceTargetContext.narration || '未知'}` : ''}\n\n## 当前分支深度: ${maxDepth + 1}\n\n请生成该节点的完整叙述和后续选项。叙述要承接上面的剧情经过，保持因果连贯。`,
          temperature: 0.7,
          maxTokens: 2048,
        });
        const decision = parseJsonFromResponse(decisionResponse);

        if (decision.narration) {
          const modResult = moderateContent(decision.narration);
          if (!modResult.safe) decision.narration = sanitizeOutput(decision.narration);
        }

        node.data.narration = decision.narration || node.data.narration;
        if (decision.title) node.data.title = decision.title;

        // Build updated context chain: append this node's narration for child nodes
        const prevContext = node.data.metadata?.storyContext || '';
        const updatedContext = `${prevContext}\n[${node.data.title}] ${(node.data.narration || '').slice(0, 200)}`.slice(-800); // Cap at 800 chars

        // Build choices from LLM output (skip for endings)
        const target = convergenceTarget || (mainPlotNodeIds || [])[0];
        const llmChoices = (decision.choices || []) as { text: string; type: string }[];

        if (node.type !== 'ending' && llmChoices.length > 0 && target) {
          const builtChoices = llmChoices.map((c: { text: string; type: string; converge_narration?: string }, i: number) => {
            if (c.type === 'converge' && target) {
              const convergeNodeId = `ai_converge_${Date.now()}_${node.id}_${i}`;
              nodeExtraNodes.push({
                id: convergeNodeId, type: 'ai_generated', position: { x: 0, y: 0 },
                data: {
                  title: c.text, narration: '',
                  dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                  choices: [{ id: `choice_${convergeNodeId}_main`, text: '继续', targetNodeId: target }],
                  allowCustomInput: false, depth: 0, voiceSegments: [], frames: [],
                  metadata: {
                    tags: ['ai_generated', 'converge_bridge'],
                    storyContext: updatedContext,
                    convergenceTarget: target,
                    convergenceHint: c.converge_narration || '',
                    bridgeDepth: 0,
                  },
                },
              });
              return { id: `choice_${node.id}_${i}`, text: c.text, targetNodeId: convergeNodeId };
            } else if (c.type === 'branch' && maxDepth < 1) {
              const branchNodeId = `ai_branch_${Date.now()}_${node.id}_${i}`;
              nodeExtraNodes.push({
                id: branchNodeId, type: 'ai_generated', position: { x: 0, y: 0 },
                data: {
                  title: c.text, narration: '',
                  dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                  choices: [{ id: `choice_${branchNodeId}_back`, text: '回到主线', targetNodeId: target }],
                  allowCustomInput: true, depth: 0, voiceSegments: [], frames: [],
                  metadata: { tags: ['ai_generated', 'branch_continue'], storyContext: updatedContext },
                },
              });
              return { id: `choice_${node.id}_${i}`, text: c.text, targetNodeId: branchNodeId };
            } else if (c.type === 'ending') {
              const endingNodeId = `ai_ending_${Date.now()}_${node.id}_${i}`;
              nodeExtraNodes.push({
                id: endingNodeId, type: 'ending', position: { x: 0, y: 0 },
                data: {
                  title: c.text, narration: '',
                  dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                  choices: [], allowCustomInput: false, depth: 0, voiceSegments: [], frames: [],
                  metadata: { tags: ['ai_generated', 'ending'], storyContext: updatedContext },
                },
              });
              return { id: `choice_${node.id}_${i}`, text: c.text, targetNodeId: endingNodeId };
            }
            return { id: `choice_${node.id}_${i}`, text: c.text, targetNodeId: target };
          });
          node.data.choices = builtChoices;
        }
      } catch {
        // Keep stub narration if LLM fails
      }
    }

    // Step 2: Generate full content (storyboard + voice + TTS)
    const { frames, voiceSegments } = await generateNodeContent(node, entities, style, defaultVoice || 'narrator');

    return {
      completed: {
        nodeId: node.id,
        data: { narration: node.data.narration, title: node.data.title, choices: node.data.choices, frames, voiceSegments },
      },
      extraNodes: nodeExtraNodes,
    };
  }

  // Process all nodes in PARALLEL for speed
  const results = await Promise.allSettled(nodes.map((n: any) => processNode(n)));

  const completedNodes: Array<{ nodeId: string; data: Partial<StoryNode['data']> }> = [];
  const newExtraNodes: StoryNode[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      completedNodes.push(result.value.completed);
      newExtraNodes.push(...result.value.extraNodes);
    }
  }

  return NextResponse.json({ completedNodes, newExtraNodes });
}
