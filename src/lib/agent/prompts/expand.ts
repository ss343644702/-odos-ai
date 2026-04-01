export const EXPAND_SYSTEM_PROMPT = `你是一个互动影游编剧助手。你的任务是为一个选项生成 2-3 个后续节点方案，供创作者选择。

## 核心原则
- 每个方案必须有**明显差异**：不同的叙事方向、不同的情感色彩、不同的信息揭示
- 方案要让创作者觉得"每个都想选"，而不是有明显的好坏之分
- 叙述使用第二人称"你"，让玩家代入主角视角

## 方案设计要求

每个方案包含：
- **title**: 简洁的标题（4-8字）
- **narrationPreview**: 叙述预览（60-100字，给创作者看的概要）
- **direction**: 一句话说明这个方案的走向和它通向的结局方向
- **isEnding**: 是否为结局节点（true/false）
- **fullNode**: 完整的节点数据
  - title: 节点标题
  - narration: 完整叙述文本（100-200字，第二人称"你"视角）
  - dialogue: 角色对话（可为null）
  - character: 说话角色（可为null）
  - imagePrompt: 英文图片描述（20-40 words）
  - choices: 后续选项数组（每个只有text字段）
  - **注意：choices 的数量由系统指定（见用户消息中的"选项数量要求"），必须严格遵守**

## 阶段感知

根据当前深度在总深度中的位置，调整方案风格：

**前期（depth < 40% maxDepth）— 发散探索**
- 大胆引入新元素：新角色、新线索、新冲突
- 每个方案开辟不同的叙事可能性

**中期（40%-70%）— 发展深化**
- 推进已有冲突，不要引入太多新元素
- 至少 1 个方案暗示收束的可能
- 回扣前面埋下的伏笔

**后期（70%+ 或 总节点 > 15）— 走向结局**
- 必须有至少 1 个 isEnding=true 的结局方案
- 非结局方案的 choices 最多 1 个（限制继续发散）
- 带着情感重量收束：得到了什么、失去了什么

## 输出格式（严格 JSON）
{
  "proposals": [
    {
      "id": "p1",
      "title": "方案标题",
      "narrationPreview": "叙述预览60-100字",
      "direction": "一句话走向说明",
      "isEnding": false,
      "fullNode": {
        "title": "节点标题",
        "narration": "完整叙述100-200字",
        "dialogue": "对话或null",
        "character": "角色名或null",
        "imagePrompt": "English image description",
        "choices": [
          { "text": "选项文字" }
        ]
      }
    }
  ]
}

## 格式注意
- 输出合法 JSON，不要使用 Markdown 格式
- choices 中只需要 text 字段，id 和 targetNodeId 由系统自动生成`;

export interface ExpandContext {
  parentNode: { title: string; narration: string };
  choiceText: string;
  existingNodes: { id: string; title: string; depth: number; type: string }[];
  outline: { theme: string; tone: string; worldView?: string; characters: any[]; endings: any[] };
  depth: number;
  maxDepth: number;
  openBranches: number;
  totalNodes: number;
  /** How many choices each non-ending proposal should have */
  choiceCount: number;
  /** Current branch path for context continuity */
  branchPath?: string[];
}

export const EXPAND_USER_PROMPT = (ctx: ExpandContext) => {
  const depthPercent = ctx.maxDepth > 0 ? ctx.depth / ctx.maxDepth : 0;
  const phase = depthPercent < 0.4 ? '前期（发散探索）' : depthPercent < 0.7 ? '中期（发展深化）' : '后期（走向结局）';

  const nodeList = ctx.existingNodes
    .map((n) => `  ${n.id}: ${n.title} (${n.type}, depth ${n.depth})`)
    .join('\n');

  const charList = (ctx.outline.characters || [])
    .map((c: any) => `${c.name}(${c.role}): ${c.description}`)
    .join('\n  ');

  const endingList = (ctx.outline.endings || [])
    .map((e: any) => `[${e.type}] ${e.title}: ${e.description}`)
    .join('\n  ');

  const choiceReq = ctx.choiceCount === 0
    ? '⚠️ 所有方案的 choices 必须为空数组（结局节点）。'
    : `⚠️ 非结局方案的 choices 必须恰好 ${ctx.choiceCount} 个选项。结局方案 choices 为空数组。`;

  const branchContext = ctx.branchPath?.length
    ? `\n当前故事线路径：${ctx.branchPath.join(' → ')}`
    : '';

  return `## 当前状态
阶段：${phase}
深度：${ctx.depth}/${ctx.maxDepth}（剩余 ${ctx.maxDepth - ctx.depth} 层）
已有节点：${ctx.totalNodes} 个
待展开分支：${ctx.openBranches} 条
${depthPercent >= 0.7 || ctx.totalNodes > 15 ? '⚠️ 已进入后期，必须提供至少 1 个结局方案！' : ''}

## 选项数量要求
${choiceReq}

## 故事背景
主题：${ctx.outline.theme}
基调：${ctx.outline.tone}
${ctx.outline.worldView ? `世界观：${ctx.outline.worldView}` : ''}

角色：
  ${charList}

结局方向：
  ${endingList}
${branchContext}

## 已有节点
${nodeList || '（暂无）'}

## 需要展开的选项
来自节点「${ctx.parentNode.title}」：
> ${ctx.parentNode.narration.slice(0, 150)}${ctx.parentNode.narration.length > 150 ? '...' : ''}

玩家选择了：**"${ctx.choiceText}"**

请为这个选择生成 ${depthPercent >= 0.7 ? '2-3' : '3'} 个差异化的后续节点方案。`;
};
