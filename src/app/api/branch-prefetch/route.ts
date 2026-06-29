import { NextRequest, NextResponse } from 'next/server';
import { callLLM, parseJsonFromResponse } from '@/lib/claude';
import { moderateContent, sanitizeOutput, stripMetaVocabulary } from '@/lib/safety';
import { synthesizeSpeech } from '@/lib/minimax-tts';
import { uploadAudio } from '@/lib/oss';
import { reconcileVoiceTypes, inferEntityRefs } from '@/lib/entity-utils';
import { checkRateLimit, getRateLimitKey, PREFETCH_LIMIT } from '@/lib/rate-limit';
import { VOICE_SYSTEM_PROMPT, VOICE_USER_PROMPT } from '@/lib/agent/prompts/voice';
import { STORYBOARD_SYSTEM_PROMPT, STORYBOARD_USER_PROMPT } from '@/lib/agent/prompts/storyboard';
import { syncFramesFromVoice, assignSegmentFrames } from '@/types/story';
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
  "narration": "该节点的叙述文本（100-150字，第二人称'你'视角，简洁有力）",
  "title": "节点标题",
  "choices": [
    { "text": "选项文本", "type": "branch" },
    { "text": "选项文本", "type": "converge", "converge_narration": "50-100字过渡到目标主线节点开头" }
  ]
}

## narration 写作铁律
- **100-150字**，第二人称"你"
- 第一句必须是上步选择的**直接结果**
- ❌ 禁止：排比句、空洞形容词、比喻堆砌、内心OS、AI套话
- ✅ 用动作写心理、用细节写人物
- 严禁引用玩家尚未遇到的角色
- ⚠️ **严禁暗示玩家还没做过的事**：不能写"比盘问埃德时更…""和上次搜书房一样""她比其他人都…"这类对比/总结——这暗示玩家已经做过那些事。叙述只能基于【故事至此】里真实发生过的内容，玩家没经历过的对比、回忆一律不许出现。
- ⚠️ **严禁出现任何"游戏结构"元词汇**：narration 和选项里**绝对不能**出现"支线""主线""分支""收束""回到主线""剧情线""路线""玩家""选项""节点"这类词——会暴露游戏机制、破坏沉浸感。要用剧情内的说法复述玩家做过的事（不要写"你已经在支线中拆开了所有勒索信"，要写"你已经拆开了那几封勒索信"）。上文我（系统）用"支线/主线/收束"只是和你沟通，绝不能照搬进写给玩家的文字。

## choices 要求
- 恰好 **2 个选项**，每个是**具体行动**（不是态度/方向）
- 两个选项导向不同后果，选了就回不了头
- **branch（1个）**: 当前情境下的具体行动
- **converge（1个）**: 具体行动 + converge_narration（50-80字）过渡到主线
- **converge 选项也必须是具体行动**，不能是"回到主线"这种 meta 表述
  ✅ "把线索带回去找陈雅核实"（自然导向主线）
  ❌ "回到故事主线"（meta，破坏沉浸感）

## 收束目标（convergeTargetId）——知识一致性铁律
你会收到一份【可收束的主线节点】候选列表（含每个节点的剧情）。converge 选项要收束回其中一个，请输出 convergeTargetId：
- ⚠️ **绝不能收束到"剧情更早、假设玩家还不知道某件他其实已经知道的事"的节点**——那会让玩家信息倒退、自相矛盾。
- ⚠️ **更关键：如果某个主线节点描述的事件，玩家在支线里【已经做过/已经经历过】，绝不能收束到那个节点——必须收束到它【之后】的节点。** 否则玩家会把同一段剧情看两遍（例：玩家已经在支线里找到并拆开了勒索信，就绝不能收束回"在抽屉暗格里第一次发现勒索信"那个节点，而要收束到"信件公开之后"的下一个节点）。
- 对照【故事至此】（玩家已知的线性剧情）逐个比对候选节点：跳过所有"玩家已经经历过其核心事件"的节点，选**第一个玩家还没经历过的**前向节点。
- 若玩家的探索已经把核心谜题/关键证据揭开，使中段主线都已"过时"，就选**最靠后的节点**（更接近结局）。
- convergeTargetId 必须是候选列表里的有效 ID。
- ⚠️ **候选节点的剧情只供你内部判断收束目标用，绝对禁止泄露到 narration 或 choices 里**：玩家还没亲历的主线具体信息（地点、物证、发现，例如"暗格里的勒索信副本""第二具尸体"）**一个字都不能出现**在你写的叙述和选项中。narration 和 choices 只能基于【故事至此】里玩家**已经亲历**的内容来写。

## 反剧透铁律（最重要）
- narration 和**每一个选项**都只能引用玩家在【故事至此】里**已经经历/已经知道**的人物、地点、物证、信息。
- 玩家**还没发现**的东西，不能在选项里提（例：玩家还没找到暗格里的勒索信，就不能给出"去和暗格里的勒索信副本对照"这种选项——那等于提前告诉玩家有这些信）。
- 选项必须是"以玩家当前已知"为前提、合乎逻辑的下一步行动。

## 输出格式 (JSON)
{
  "narration": "...",
  "title": "...",
  "convergeTargetId": "converge选项收束到的主线节点ID（从候选列表里选）",
  "choices": [ { "text": "...", "type": "branch" }, { "text": "...", "type": "converge", "converge_narration": "..." } ]
}`;

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
- **canConnect=true 时**：narration 只写两件事——①支线选择带来的**直接后果/影响**；②你由此**动身离开支线、朝目标主线方向前进**。在**即将到达目标场景时收住**（停在"门口"）。
- **canConnect=false 时**：narration 描述朝目标方向推进一步的剧情（不要硬跳），nextBridgeHint 给出下一步过渡的方向
- ⚠️ **最重要：不要剧透/复述目标主线节点的剧情**。目标节点的情节（到了那里看到什么、发生什么对话、有什么发现、环境细节）由**下一个节点**来讲，你只负责把玩家带到那里。如果你在这里把目标场景写出来，玩家就会看到两遍同样的剧情——这是绝对要避免的。
  - ❌ 反例（剧透了目标场景）："你赶回书房，推开门，发现桌上的信件不翼而飞，壁炉里还有未烧尽的纸灰。"
  - ✅ 正例（停在门口）："你攥着线索，快步穿过长廊往书房赶，门就在眼前。"
- **严禁**使用以下套话和 meta 描述：
  - "无论你之前选择了哪条路"、"殊途同归"、"命运的齿轮"
  - "故事回到了主线"、"命运交汇"、"所有道路汇聚于此"
  - 任何暗示"多条路线合并"的表述
  - ⚠️ **任何"游戏结构"元词汇**："支线""主线""分支""收束""剧情线""路线""玩家""选项""节点"——绝不能出现在 narration 里。复述玩家做过的事要用剧情内说法（写"你已经拆开了那几封勒索信"，不写"你已经在支线中拆开了勒索信"）。上文我用"支线/主线"只是和你沟通，不是给玩家看的词。
- 要有具体的画面感：人物在做什么、看到什么、感受到什么
- 叙述必须是具体的剧情推进，不能是抽象的命运感慨`;

/** Best-effort extract the narration value from a raw (possibly malformed) LLM response. Captures
 *  up to the NEXT known field key so unescaped inner quotes (e.g. a shop named 「"哈丁药房"」, which
 *  breaks JSON) don't truncate the narration at the first quote. */
function salvageNarration(raw: string): string {
  const keys = '(?:title|choices|convergenceNodeId|convergenceReason|action|targetChoiceId|customEnding|customEndingTitle|customEndingDescription|message|nextBridgeHint|canConnect)';
  let m = raw.match(new RegExp(`"narration"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"${keys}"`));
  if (!m) m = raw.match(/"narration"\s*:\s*"([\s\S]*?)"\s*\}/);          // narration is the last field
  if (!m) m = raw.match(/"narration"\s*:\s*"((?:[^"\\]|\\.){10,})"?/);   // last resort (may be truncated)
  if (!m) return '';
  return m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

/** Best-effort extract {text,type} choices from a raw (possibly malformed) LLM response, so a
 *  JSON-parse failure doesn't strip a branch node down to its single forced-converge fallback. */
function salvageChoices(raw: string): { text: string; type: string; converge_narration?: string }[] {
  const out: { text: string; type: string; converge_narration?: string }[] = [];
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.){1,120}?)"[^}]*?"type"\s*:\s*"(branch|converge|ending)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && out.length < 4) {
    let text = m[1];
    try { text = JSON.parse(`"${m[1]}"`); } catch { /* keep raw */ }
    out.push({ text, type: m[2] });
  }
  return out;
}

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

  // Generate storyboard (scene-aware image prompts) + voice in PARALLEL. The storyboard LLM is the
  // same one the main pipeline uses — without it, prefetched nodes got generic prompts built only
  // from style + character names + the node title ("dramatic scene… {title}"), which produced
  // images unrelated to what the narration actually depicts. Voice runs alongside, so wall-clock
  // is ~max(storyboard, voice), not the sum.
  const stylePrefix = style?.stylePromptPrefix || '';
  const [storyboardResult, voiceResult] = await Promise.all([
    callLLM({
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userMessage: STORYBOARD_USER_PROMPT(
        JSON.stringify({ id: nodeId, data: { narration: narrationText, title: node.data.title, dialogue: node.data.dialogue, character: node.data.character } }),
        JSON.stringify(entities || {}),
        stylePrefix,
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
      })) as Frame[];
    }).catch(() => null),
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
    }).catch(() => null),
  ]);

  let voiceSegments: VoiceSegment[] = voiceResult
    ? voiceResult.filter((s: VoiceSegment) => s.text.trim())
    : [{ id: `seg_${nodeId}_0`, text: narrationText, speaker: 'narrator', voiceType: (defaultVoice as any) || 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null }];
  if (voiceSegments.length === 0) {
    voiceSegments = [{ id: `seg_${nodeId}_0`, text: narrationText, speaker: 'narrator', voiceType: (defaultVoice as any) || 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null }];
  }

  // Force character segments to their entity-defined voiceType (entity = source of truth)
  voiceSegments = reconcileVoiceTypes(voiceSegments, entities);

  // Fallback when the storyboard LLM failed: derive a frame's prompt heuristically from style +
  // the character names present in its narration segment. Far less scene-aware than the storyboard
  // (no setting/action/composition), so it's only used if the LLM call errored.
  const buildFrame = (id: string, seg: string, duration: number): Frame => {
    const present = (entities?.characters || []).filter((c: any) => c.name && seg.includes(c.name));
    const appearance = present.map((c: any) => c.appearance || c.imagePrompt).filter(Boolean).join('；');
    const imagePrompt = [stylePrefix, appearance, `dramatic scene, cinematic lighting, ${seg.slice(0, 60)}`]
      .filter(Boolean).join(' ');
    return { id, narrationSegment: seg, imagePrompt, imageUrl: null, duration, entityRefs: inferEntityRefs(entities, seg) } as Frame;
  };
  let frames: Frame[];
  if (storyboardResult && storyboardResult.length > 0) {
    frames = storyboardResult.slice(0, 2); // cap at 2 frames per prefetch node
  } else if (narrationText.length >= 100) {
    const mid = Math.floor(narrationText.length / 2);
    const splitIdx = narrationText.indexOf('。', mid);
    const splitAt = splitIdx > 0 ? splitIdx + 1 : mid;
    frames = [
      buildFrame(`frame_${nodeId}_0`, narrationText.slice(0, splitAt), Math.max(3, Math.ceil(splitAt / 15))),
      buildFrame(`frame_${nodeId}_1`, narrationText.slice(splitAt), Math.max(3, Math.ceil((narrationText.length - splitAt) / 15))),
    ];
  } else {
    frames = [buildFrame(`frame_${nodeId}_0`, narrationText, Math.max(3, Math.ceil(narrationText.length / 15)))];
  }

  // TTS only — images are deliberately NOT generated here. Prefetch generates content + voice for
  // ALL next-step options so they're instantly ready; the first-frame image is generated on demand
  // when the player actually picks an option (only the chosen branch pays the image cost/latency).
  // Remaining frames fill client-side after navigation.
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
    voiceSegments = assignSegmentFrames(frames, voiceSegments);
    frames = syncFramesFromVoice(frames, voiceSegments);
  }

  return { frames, voiceSegments };
}

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`prefetch:${getRateLimitKey(request)}`, PREFETCH_LIMIT).allowed) {
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] }, { status: 429 });
  }

  // Prefetch is fire-and-forget from the client, which aborts the in-flight request whenever it
  // starts a newer one or leaves the node. An aborted request reaches here with a truncated/empty
  // body, so request.json() throws "Unexpected end of JSON input". Treat any parse failure as
  // "nothing to do" (200, empty result) instead of letting it surface as an unhandled 500.
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] });
  }
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
    storyline, // linear story-so-far (start → current node), from history only (no abandoned branches)
  } = body;

  if (!nodes || nodes.length === 0) {
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] });
  }

  // Character roster — keep generated continuation/bridge narration anchored to the actual cast
  // (mirrors the same fix in branch-pipeline) so the AI doesn't invent unrelated characters.
  const characterRoster = (entities?.characters || [])
    .map((c: any) => `- ${c.name}${c.personality ? `（${String(c.personality).slice(0, 30)}）` : ''}: ${String(c.description || '')}`)
    .join('\n');
  const rosterBlock = characterRoster
    ? `\n\n## 故事角色（权威设定，不可违背；只能使用这些角色，严禁虚构新角色）\n${characterRoster}\n⚠️ 严格遵守每个角色的身份与因果：谁对谁做了什么、谁是施害者谁是受害者，必须与设定一致，绝不能颠倒。不要虚构设定中未写明的人物背景或事件经过（死因、动机、亲属关系等）。`
    : '';

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
    let bridgeTarget = meta.convergenceTarget || convergenceTarget;
    // Guard: a bridge must never converge to the START node (loops to the opening). Stale main_1
    // can be inherited from older nodes — redirect to the first non-start spine node.
    const bStartId = (mainPlotNodes || []).find((n: any) => n.type === 'start')?.id
      || (/^main_1$/.test((mainPlotNodeIds || [])[0] || '') ? mainPlotNodeIds[0] : '');
    if (bridgeTarget && bridgeTarget === bStartId) {
      const spine = (mainPlotNodeIds || []).filter((id: string) => /^main_/.test(id) && id !== bStartId);
      bridgeTarget = spine[0] || (mainPlotNodeIds || [])[1] || bridgeTarget;
    }
    const bridgeDepth = (meta.bridgeDepth ?? 0) as number;
    const hint = meta.convergenceHint || '';

    // Find target node context from mainPlotNodes
    const targetNode = (mainPlotNodes || []).find((n: any) => n.id === bridgeTarget);
    const targetTitle = targetNode?.title || convergenceTargetContext?.title || '未知';
    const targetNarration = targetNode?.narration || convergenceTargetContext?.narration || '未知';

    // If we've reached max bridge depth, force connection
    const forceConnect = bridgeDepth >= MAX_BRIDGE_DEPTH;

    // The decision LLM's `converge_narration` is stored as convergenceHint — a purpose-built
    // transition that honors the player's specific choice AND leads into the target's opening.
    // When it's substantial, USE IT directly. Regenerating via BRIDGE_PROMPT here tends to ignore
    // the choice and re-tell the target node verbatim (the bug: choosing "给她一个解释的机会" jumped
    // straight to her arrest + the ending). Only fall back to BRIDGE_PROMPT when there's no usable
    // hint (e.g. branch-fallback bridges, or multi-step bridges that need their own narration).
    const hintIsUsableTransition = typeof hint === 'string' && hint.trim().length >= 30;

    try {
      let canConnect = true;
      let bridgeNextHint = ''; // only set when regenerating (canConnect=false multi-step path)
      if (hintIsUsableTransition) {
        let narration = hint.trim();
        const mod = moderateContent(narration);
        if (!mod.safe) narration = sanitizeOutput(narration);
        node.data.narration = narration;
        // A converge_narration was provided → the decision already chose to converge here.
        canConnect = true;
      } else {
        const bridgeResponse = await callLLM({
          systemPrompt: BRIDGE_PROMPT,
          userMessage: [
            `## 故事世界观`,
            worldView || '(无)',
            rosterBlock,
            ``,
            ...(playerObjective ? [
              `## 玩家目标`,
              `目标：${playerObjective.primary}`,
              `隐藏真相：${playerObjective.hidden}`,
              `衡量维度：${playerObjective.measurement}`,
              ``,
            ] : []),
            `## 当前支线节点`,
            `标题: ${node.data.title}`,
            ``,
            ...(storyline ? [
              `## 故事至此（玩家实际经历的线性剧情，从开头到现在；过渡必须与之一致，不得矛盾）`,
              storyline,
              ``,
            ] : []),
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
          temperature: 0.5,
          maxTokens: 2048,
        });
        const bridge = parseJsonFromResponse(bridgeResponse);

        if (bridge.narration) {
          const modResult = moderateContent(bridge.narration);
          if (!modResult.safe) bridge.narration = sanitizeOutput(bridge.narration);
        }

        node.data.narration = bridge.narration || `你决定${node.data.title}。事态在不知不觉中发生了变化...`;
        if (bridge.title) node.data.title = bridge.title;

        canConnect = forceConnect || bridge.canConnect !== false;
        bridgeNextHint = bridge.nextBridgeHint || '';
      }

      const updatedBridgeContext = `${meta.storyContext || ''}\n[过渡] ${node.data.narration || ''}`.slice(-6000);

      if (canConnect) {
        // Find the target mainline node to check if it has choices
        const targetNode = (mainPlotNodes || []).find((n: any) => n.id === bridgeTarget);

        if (targetNode && targetNode.choices?.length > 0) {
          // Generate an "alternative mainline node" with context-aware narration + same choices
          try {
            const altResponse = await callLLM({
              systemPrompt: `你是一个互动影游的剧情引擎。上一个节点（过渡）已经把玩家**带到了目标场景的门口**，现在由你来写**推开门之后、到达目标场景的此刻**。
要求：
- 100-150字，第二人称"你"视角
- **承接上一段过渡，但绝不重复它**：过渡写的是"你赶往这里"，你写的是"你到了之后看到/面对什么"。两段读起来要像连续的一前一后，而不是把同一件事讲两遍。
- 直接落地目标情境：玩家现在在哪、眼前是什么、面对什么局面，结束时的情境与目标主线节点一致，让后续选项逻辑上讲得通
- 不要照抄目标主线节点的叙述原文，用你自己的话把同一处境写出来
- 输出JSON: {"narration": "...", "title": "..."}`,
              userMessage: `## 上一个节点的过渡叙述（你要承接它的"到门口"，但不要重复它的内容）\n${node.data.narration || ''}\n\n## 目标主线节点（你要落地到这个处境，但用自己的话写，别照抄）\n标题: ${targetNode.title || ''}\n叙述: ${targetNode.narration || ''}\n\n## 目标主线节点的选项（你的叙述结束后玩家会看到这些）\n${(targetNode.choices || []).map((c: any) => `- ${c.text}`).join('\n')}\n\n请写"推开门之后到达目标场景的此刻"，承接过渡但不重复。`,
              temperature: 0.5,
              maxTokens: 1024,
            });
            const alt = parseJsonFromResponse(altResponse);

            const altNodeId = `ai_alt_${Date.now()}_${node.id}`;
            nodeExtraNodes.push({
              id: altNodeId, type: 'ai_generated' as const, position: { x: 0, y: 0 },
              data: {
                title: alt.title || targetNode.title || '命运转折',
                narration: alt.narration || node.data.narration || '',
                dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                choices: (targetNode.choices || [])
                  .filter((c: any) => !c.visibility || c.visibility !== 'hidden')
                  .map((c: any) => ({
                    id: `choice_alt_${altNodeId}_${c.id || Date.now()}`,
                    text: c.text,
                    targetNodeId: c.targetNodeId,
                  })),
                allowCustomInput: true, depth: 0, voiceSegments: [], frames: [],
                metadata: { tags: ['ai_generated', 'alt_mainline'], storyContext: updatedBridgeContext },
              },
            });

            // Bridge points to the alternative node, not directly to mainline
            node.data.choices = [{
              id: `choice_${node.id}_alt`,
              text: '继续',
              targetNodeId: altNodeId,
            }];
          } catch {
            // Fallback: point directly to mainline if LLM fails
            node.data.choices = [{
              id: `choice_${node.id}_main`,
              text: '继续',
              targetNodeId: bridgeTarget,
            }];
          }
        } else {
          // Target has no choices (ending node) — point directly
          node.data.choices = [{
            id: `choice_${node.id}_main`,
            text: '继续',
            targetNodeId: bridgeTarget,
          }];
        }
      } else {
        // Need more bridging — create next bridge stub with accumulated context
        const nextBridgeId = `ai_bridge_${Date.now()}_${node.id}`;
        const nextHint = bridgeNextHint || '';
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

    // Final guarantee: never leave a bridge node empty (parse failure etc.) or the player's
    // choice-wait poll spins forever. The stub already carries a fallback "继续" choice to the
    // mainline target, so a minimal transition narration makes it playable.
    if (!node.data.narration) {
      node.data.narration = `你顺着眼前的线索继续向前，场景在不知不觉中转换，新的局面正在你面前展开。`;
    }

    // Generate voice + TTS
    const { frames, voiceSegments } = await generateNodeContent(node, entities, style, defaultVoice || 'narrator');

    // Scrub leaked game-structure meta vocabulary (支线/主线/收束…) from player-facing text.
    node.data.narration = stripMetaVocabulary(node.data.narration || '');
    (node.data.choices || []).forEach((ch: any) => { if (ch?.text) ch.text = stripMetaVocabulary(ch.text); });

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
      let rawResponse = '';
      let decision: any = {};
      try {
        const storylineBlock = storyline
          ? `\n\n## 故事至此（玩家实际经历的线性剧情，从开头到现在；这是唯一权威前情，你的叙述必须与之一致，不得矛盾）\n${storyline}`
          : '';
        // Candidate convergence nodes (forward spine, excluding the start node) with their plot, so
        // the LLM can pick a knowledge-CONSISTENT target instead of inheriting a possibly-stale one.
        const cStartId = (mainPlotNodes || []).find((n: any) => n.type === 'start')?.id
          || (/^main_1$/.test((mainPlotNodeIds || [])[0] || '') ? mainPlotNodeIds[0] : '');
        const candidates = (mainPlotNodes || [])
          .filter((n: any) => /^main_/.test(n.id) && n.id !== cStartId)
          .map((n: any) => `- [${n.id}] ${n.title || ''}: ${(n.narration || '').slice(0, 220)}`)
          .join('\n');
        const candidatesBlock = candidates
          ? `\n\n## 可收束的主线节点（仅供你选 convergeTargetId 用；⚠️ 这些剧情玩家还没亲历，绝不能写进 narration 或选项里）\n${candidates}`
          : '';
        const decisionResponse = await callLLM({
          systemPrompt: BRANCH_CONTINUE_PROMPT,
          userMessage: node.type === 'ending'
            ? `## 故事世界观\n${worldView}${rosterBlock}${playerObjective ? `\n\n## 玩家目标\n目标：${playerObjective.primary}\n隐藏真相：${playerObjective.hidden}\n衡量维度：${playerObjective.measurement}` : ''}${storylineBlock}\n\n## 结局节点\n标题: ${node.data.title}\n\n## 此前的支线剧情经过\n${node.data.metadata?.storyContext || '(无)'}\n\n请为这个结局生成一段完整的叙述（100-200字），不需要选项。用第二人称"你"视角，给故事一个有感染力的收尾。叙述必须承接上面的支线剧情，体现玩家策略选择的后果。输出JSON: {"narration": "...", "title": "..."}`
            : `## 故事世界观\n${worldView}${rosterBlock}${playerObjective ? `\n\n## 玩家目标\n目标：${playerObjective.primary}\n隐藏真相：${playerObjective.hidden}\n衡量维度：${playerObjective.measurement}` : ''}${storylineBlock}\n\n## 当前分支节点\n标题: ${node.data.title}\n\n## 此前的支线剧情经过（你的叙述必须承接这些内容）\n${node.data.metadata?.storyContext || '(无)'}${candidatesBlock}\n\n## 当前分支深度: ${maxDepth + 1}\n\n请生成该节点的完整叙述和后续选项。叙述要承接上面的剧情经过，保持因果连贯。converge 选项请按知识一致性选择 convergeTargetId。`,
          temperature: 0.6,
          maxTokens: 2048,
        });
        rawResponse = decisionResponse;
        decision = parseJsonFromResponse(decisionResponse);
      } catch {
        // LLM call or JSON parse failed (e.g. malformed JSON / unescaped inner quotes). Salvage
        // narration AND choices from the raw text — losing them is what previously truncated the
        // narration mid-sentence and stripped a branch node to its forced-converge fallback.
        const n = salvageNarration(rawResponse);
        if (n) decision.narration = n;
        decision.choices = salvageChoices(rawResponse);
      }

      if (decision.narration) {
        const modResult = moderateContent(decision.narration);
        if (!modResult.safe) decision.narration = sanitizeOutput(decision.narration);
      }
      node.data.narration = decision.narration || node.data.narration;
      if (decision.title) node.data.title = decision.title;

      // Build updated context chain: append this node's narration for child nodes
      const prevContext = node.data.metadata?.storyContext || '';
      const updatedContext = `${prevContext}\n[${node.data.title}] ${node.data.narration || ''}`.slice(-6000); // rolling context cap (GLM 1M window)

      // Prefer the node's OWN convergenceTarget (threaded down the branch chain) over the
      // request-level one; only as a last resort fall back to mainPlotNodeIds[0].
      // Guard: never converge to the START node (loops the player to the opening). A stale main_1
      // can be inherited from older nodes generated before the fix — redirect to the next spine node.
      const startId = (mainPlotNodes || []).find((n: any) => n.type === 'start')?.id
        || (/^main_1$/.test((mainPlotNodeIds || [])[0] || '') ? mainPlotNodeIds[0] : '');
      let target = node.data.metadata?.convergenceTarget || convergenceTarget || (mainPlotNodeIds || [])[0];
      // Knowledge-aware re-selection (B): trust the LLM's convergeTargetId — it picked from the
      // candidate list under the knowledge-consistency rule — over the inherited target, so the
      // convergence point advances as the player learns more instead of regressing to an earlier node.
      const chosen = decision.convergeTargetId;
      if (chosen && chosen !== startId && (mainPlotNodeIds || []).includes(chosen)) {
        target = chosen;
      }
      if (target && target === startId) {
        const spine = (mainPlotNodeIds || []).filter((id: string) => /^main_/.test(id) && id !== startId);
        target = spine[0] || (mainPlotNodeIds || [])[1] || target;
      }
      let llmChoices = (decision.choices || []) as { text: string; type: string; converge_narration?: string }[];

      // A non-ending branch node with NO usable choices must not be left with only its single
      // forced-converge fallback — that silently returns the player to the mainline before they've
      // finished exploring (the reported "点继续强行回主线" bug). Synthesize a continue-exploring
      // branch + a converge so the choice to keep going is always preserved.
      if (node.type !== 'ending' && llmChoices.length === 0) {
        llmChoices = [
          { text: '继续追查眼前的线索', type: 'branch' },
          { text: '收起线索，先回到原本的调查', type: 'converge' },
        ];
      }

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
          } else if (c.type === 'branch') {
            const branchNodeId = `ai_branch_${Date.now()}_${node.id}_${i}`;
            // Create converge_bridge fallback for branch node
            const branchConvergeId = `ai_branch_converge_${Date.now()}_${node.id}_${i}`;
            nodeExtraNodes.push({
              id: branchConvergeId, type: 'ai_generated', position: { x: 0, y: 0 },
              data: {
                title: '回到主线', narration: '',
                dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                choices: [{ id: `choice_${branchConvergeId}_main`, text: '继续', targetNodeId: target }],
                allowCustomInput: false, depth: 0, voiceSegments: [], frames: [],
                metadata: {
                  tags: ['ai_generated', 'converge_bridge'],
                  storyContext: updatedContext,
                  convergenceTarget: target,
                  convergenceHint: '',
                  bridgeDepth: 0,
                },
              },
            });
            nodeExtraNodes.push({
              id: branchNodeId, type: 'ai_generated', position: { x: 0, y: 0 },
              data: {
                title: c.text, narration: '',
                dialogue: null, character: null, imageUrl: null, imagePrompt: '', audioUrl: null,
                choices: [{ id: `choice_${branchNodeId}_back`, text: '继续', targetNodeId: branchConvergeId }],
                allowCustomInput: true, depth: 0, voiceSegments: [], frames: [],
                // Carry convergenceTarget so even deeper exploration keeps converging forward to
                // the same target instead of falling back to mainPlotNodeIds[0] (= the first node).
                metadata: { tags: ['ai_generated', 'branch_continue'], storyContext: updatedContext, convergenceTarget: target },
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

      // Final guarantee: a stub must never stay empty, or the player's choice-wait poll spins
      // forever (the node never becomes isNodeReady). Synthesize a minimal continuation from the
      // stub's title; the node now also carries real exploration choices (above), so it's playable.
      if (!node.data.narration) {
        const t = (node.data.title || '').replace(/^["'「『]|["'」』]$/g, '').trim();
        node.data.narration = t
          ? `你${t}。眼前的局面随之发生了变化，你需要尽快做出下一步判断。`
          : `你的选择带来了新的变化，眼前的局面正在悄然改变。`;
      }
    }

    // Step 2: Generate full content (storyboard + voice + TTS)
    const { frames, voiceSegments } = await generateNodeContent(node, entities, style, defaultVoice || 'narrator');

    // Scrub leaked game-structure meta vocabulary (支线/主线/收束…) from player-facing text.
    node.data.narration = stripMetaVocabulary(node.data.narration || '');
    (node.data.choices || []).forEach((ch: any) => { if (ch?.text) ch.text = stripMetaVocabulary(ch.text); });

    return {
      completed: {
        nodeId: node.id,
        data: { narration: node.data.narration, title: node.data.title, choices: node.data.choices, frames, voiceSegments },
      },
      extraNodes: nodeExtraNodes,
    };
  }

  // Process all nodes in PARALLEL for speed. processNode already swallows its own errors, but
  // wrap the whole batch so any unexpected throw degrades to an empty 200 (background task —
  // never surface a 500 the player can't act on).
  try {
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
  } catch (err) {
    console.error('Branch prefetch error:', err);
    return NextResponse.json({ completedNodes: [], newExtraNodes: [] });
  }
}
