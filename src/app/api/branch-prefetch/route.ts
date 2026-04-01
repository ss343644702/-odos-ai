import { NextRequest, NextResponse } from 'next/server';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';
import { moderateContent, sanitizeOutput } from '@/lib/safety';
import { synthesizeSpeech } from '@/lib/minimax-tts';
import { uploadAudio } from '@/lib/oss';
import { STORYBOARD_SYSTEM_PROMPT, STORYBOARD_USER_PROMPT } from '@/lib/agent/prompts/storyboard';
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
- 推荐组合: 2个 branch + 1个 converge
- 分支深度1-3时，以 branch 为主，让玩家充分探索
- 分支深度4时，推荐 1个 branch + 1个 converge + 1个 ending(可选)
- 分支深度5+时，推荐 2个 converge + 1个 ending，自然收束`;

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

  // Storyboard + Voice LLM in PARALLEL
  const [sbResult, voiceResult] = await Promise.allSettled([
    callLLM({
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userMessage: STORYBOARD_USER_PROMPT(
        JSON.stringify(node),
        JSON.stringify(entities || {}),
        style?.stylePromptPrefix || '',
      ),
      temperature: 0.7,
      maxTokens: 4096,
    }).then((r) => {
      const sb = parseJsonFromResponse(r);
      return (sb.frames || []).map((f: any, i: number) => ({
        id: `frame_${nodeId}_${i}`,
        narrationSegment: f.narrationSegment || '',
        imagePrompt: f.imagePrompt || '',
        imageUrl: null,
        entityRefs: f.entityRefs || [],
        duration: f.duration || 3,
      }));
    }),
    callLLM({
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
    }),
  ]);

  let frames: Frame[] = sbResult.status === 'fulfilled'
    ? sbResult.value
    : [{ id: `frame_${nodeId}_0`, narrationSegment: narrationText, imagePrompt: `${style?.stylePromptPrefix || ''} dramatic scene, cinematic lighting`, imageUrl: null, duration: 5 }];

  let voiceSegments: VoiceSegment[] = voiceResult.status === 'fulfilled'
    ? voiceResult.value.filter((s: VoiceSegment) => s.text.trim())
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
    branchDepth,    // current branch depth (for convergence pressure)
    convergenceTarget,
    convergenceTargetContext, // { title, narration } of the target node
  } = body;

  if (!nodes || nodes.length === 0) {
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] });
  }

  const maxDepth = branchDepth || 0;

  /** Process a single stub node: LLM narration → choices → storyboard → voice → TTS */
  async function processNode(stubNode: any) {
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
            ? `## 故事世界观\n${worldView}\n\n## 结局节点\n标题: ${node.data.title}\n上下文: ${node.data.metadata?.storyContext || ''}\n\n请为这个结局生成一段完整的叙述（100-200字），不需要选项。用第二人称"你"视角，给故事一个有感染力的收尾。输出JSON: {"narration": "...", "title": "..."}`
            : `## 故事世界观\n${worldView}\n\n## 当前分支节点\n标题: ${node.data.title}\n上下文: ${node.data.metadata?.storyContext || ''}\n\n## 主线节点ID列表\n${(mainPlotNodeIds || []).join(', ')}\n\n## 收束目标节点\nID: ${convergenceTarget}${convergenceTargetContext ? `\n标题: ${convergenceTargetContext.title || '未知'}\n剧情: ${convergenceTargetContext.narration || '未知'}` : ''}\n\n## 当前分支深度: ${maxDepth + 1}\n\n请生成该节点的完整叙述和后续选项。${maxDepth >= 4 ? '分支已较深，应优先引导收束回主线或走向新结局。converge 选项的过渡叙述要自然衔接到收束目标的剧情。' : maxDepth >= 3 ? '可以开始考虑自然收束，但不必急于回到主线。' : '继续探索玩家的选择带来的新可能性。'}`,
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

        // Build choices from LLM output (skip for endings)
        const target = convergenceTarget || (mainPlotNodeIds || [])[0];
        const llmChoices = (decision.choices || []) as { text: string; type: string }[];

        if (node.type !== 'ending' && llmChoices.length > 0 && target) {
          const builtChoices = llmChoices.map((c: { text: string; type: string; converge_narration?: string }, i: number) => {
            if (c.type === 'converge' && target) {
              const convergeNodeId = `ai_converge_${Date.now()}_${node.id}_${i}`;
              const convergeNarration = c.converge_narration || `你决定${c.text}。经过一番周折，事情逐渐回到了原来的轨道上...`;
              nodeExtraNodes.push({
                id: convergeNodeId, type: 'ai_generated', position: { x: 0, y: 0 },
                data: {
                  title: c.text, narration: convergeNarration,
                  dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                  choices: [{ id: `choice_${convergeNodeId}_main`, text: '继续', targetNodeId: target }],
                  allowCustomInput: false, depth: 0, voiceSegments: [], frames: [],
                  metadata: { tags: ['ai_generated', 'converge_transition'], storyContext: node.data.metadata?.storyContext || '' },
                },
              });
              return { id: `choice_${node.id}_${i}`, text: c.text, targetNodeId: convergeNodeId };
            } else if (c.type === 'branch' && maxDepth < 5) {
              const branchNodeId = `ai_branch_${Date.now()}_${node.id}_${i}`;
              nodeExtraNodes.push({
                id: branchNodeId, type: 'ai_generated', position: { x: 0, y: 0 },
                data: {
                  title: c.text, narration: '',
                  dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                  choices: [{ id: `choice_${branchNodeId}_back`, text: '回到主线', targetNodeId: target }],
                  allowCustomInput: true, depth: 0, voiceSegments: [], frames: [],
                  metadata: { tags: ['ai_generated', 'branch_continue'], storyContext: node.data.metadata?.storyContext || '' },
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
                  metadata: { tags: ['ai_generated', 'ending'], storyContext: node.data.metadata?.storyContext || '' },
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
