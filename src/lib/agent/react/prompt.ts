import type { ToolDescription } from './types';

// Generation tools (used in create mode)
const GENERATION_TOOLS: ToolDescription[] = [
  {
    name: 'select_style',
    description: '选择画面风格（从预设风格中选择）',
    inputSchema: '{ "styleId": "cinematic_realistic" | "cyberpunk" | "ink_wash" | "anime" | "dark_gothic" | "watercolor" }',
    outputHint: '返回风格名称和提示词前缀',
  },
  {
    name: 'generate_outline',
    description: '生成剧本大纲（角色、情节脉络、结局方向）。大纲是创作灵感蓝图，不是死板结构。depth 不传则默认 8-10 层',
    inputSchema: '{ "storyDescription": "故事描述", "styleName": "风格名", "depth": 数字(可选,推荐8-10) }',
    outputHint: '返回完整大纲：主题、世界观、角色(含秘密)、情节脉络、结局方向',
  },
  {
    name: 'expand_node',
    description: '【共创模式核心】为下一个待展开的分支生成 2-3 个差异化方案供用户选择。首次调用会初始化共创模式并生成开场方案。',
    inputSchema: '{}  // 自动读取当前状态',
    outputHint: '返回 2-3 个方案（标题、预览、走向），需要用 ask_user 展示给用户选择',
  },
  {
    name: 'apply_proposal',
    description: '应用用户选择的方案（创建节点和连线）',
    inputSchema: '{ "choice": 1|2|3|"skip" }  // 方案序号或"skip"跳过此分支',
    outputHint: '返回创建的节点信息和当前进度',
  },
  {
    name: 'auto_complete_branches',
    description: '自动完成所有剩余待展开分支（AI 自动选择方案，后期优先选结局）。用户说"自动完成"时使用。',
    inputSchema: '{}',
    outputHint: '返回自动完成的节点数和最终进度',
  },
  {
    name: 'generate_branches',
    description: '【快速模式】一次性生成完整分支剧情树。如果用户设置了隐藏结局，必须在 hiddenEndingTitle 里传入对应的结局标题。',
    inputSchema: '{ "hiddenEndingTitle": "隐藏结局的标题(可选，从大纲endings中选)" }',
    outputHint: '返回节点数、边数、结局数',
  },
  {
    name: 'extract_entities',
    description: '从剧情节点中提取角色、场景、道具等主体',
    inputSchema: '{}  // 自动从当前状态读取节点',
    outputHint: '返回角色数、场景数、道具数',
  },
  {
    name: 'generate_entity_images',
    description: '为所有主体生成参考图片（用于视觉一致性）。耗时较长。',
    inputSchema: '{}  // 自动从当前状态读取主体数据',
    outputHint: '返回成功/失败数量',
  },
  {
    name: 'generate_storyboard',
    description: '为每个剧情节点生成分镜（视觉帧、镜头、旁白分段）',
    inputSchema: '{}  // 自动从当前状态读取节点和主体',
    outputHint: '返回成功处理的节点数',
  },
  {
    name: 'generate_voice',
    description: '为每个节点生成配音分段和 TTS 音频',
    inputSchema: '{}  // 自动从当前状态读取节点和主体',
    outputHint: '返回配音分段数和音频数',
  },
];

// Edit tools (used in both create and edit modes)
const EDIT_TOOLS: ToolDescription[] = [
  {
    name: 'edit_outline',
    description: '用自然语言修改已生成的大纲（角色、情节、结局、基调等）。修改后后续生成分支会使用新大纲。',
    inputSchema: '{ "instruction": "修改指令，如：把主角改成女性、增加一个反派角色、把结局改成开放式" }',
    outputHint: '返回修改后的完整大纲摘要',
  },
  {
    name: 'edit_node',
    description: '快速修改指定剧情节点的文字字段',
    inputSchema: '{ "nodeIndex": 节点序号, "field": "narration"|"title"|"dialogue"|"character"|"imagePrompt"|"allowCustomInput", "newValue": "新值" }',
    outputHint: '返回修改确认',
  },
  {
    name: 'manage_node',
    description: '管理剧情节点 — 添加、删除、移动',
    inputSchema: '添加: { "action": "add", "type": "scene"|"ending", "title": "标题", "narration": "旁白(可选)", "afterNodeIndex": 数字(可选) }  删除: { "action": "remove", "nodeIndex": 数字 }  移动: { "action": "move", "nodeIndex": 数字, "x": 数字, "y": 数字 }',
    outputHint: '返回操作确认和受影响的节点信息',
  },
  {
    name: 'manage_edge',
    description: '管理节点间连线 — 添加、删除、列出',
    inputSchema: '添加: { "action": "add", "sourceNodeIndex": 数字, "targetNodeIndex": 数字, "label": "标签(可选)" }  删除: { "action": "remove", "sourceNodeIndex": 数字, "targetNodeIndex": 数字 }  列出: { "action": "list" }',
    outputHint: '返回操作确认或连线列表',
  },
  {
    name: 'manage_choice',
    description: '管理节点的选项 — 添加、修改、删除',
    inputSchema: '添加: { "action": "add", "nodeIndex": 数字, "text": "选项文字", "targetNodeIndex": 数字(可选) }  修改: { "action": "update", "nodeIndex": 数字, "choiceIndex": 数字, "text": "新文字(可选)", "targetNodeIndex": 数字(可选) }  删除: { "action": "remove", "nodeIndex": 数字, "choiceIndex": 数字 }',
    outputHint: '返回操作确认',
  },
  {
    name: 'manage_frame',
    description: '管理节点的画面帧 — 添加、修改、删除（仅用于微调编辑，创建时请用 generate_storyboard 批量生成）',
    inputSchema: '添加: { "action": "add", "nodeIndex": 数字, "narrationSegment": "旁白", "imagePrompt": "画面描述(可选)" }  修改: { "action": "update", "nodeIndex": 数字, "frameIndex": 数字, "narrationSegment": "...(可选)", "imagePrompt": "...(可选)", "duration": 数字(可选) }  删除: { "action": "remove", "nodeIndex": 数字, "frameIndex": 数字 }',
    outputHint: '返回操作确认',
  },
  {
    name: 'list_nodes',
    description: '详细列出所有剧情节点（索引、类型、标题、选项数、帧数、连接关系）。编辑前建议先调用。',
    inputSchema: '{ "verbose": true|false(可选，默认false) }',
    outputHint: '返回格式化的节点列表',
  },
  {
    name: 'reset_story',
    description: '清空整个故事画布（删除所有节点和连线），重置创作状态，用于重新开始',
    inputSchema: '{}',
    outputHint: '返回删除的节点数量',
  },
];

// Utility tools (always available)
const UTILITY_TOOLS: ToolDescription[] = [
  {
    name: 'get_state',
    description: '查看当前创作状态（已完成步骤、节点数量、主体数等）',
    inputSchema: '{}',
    outputHint: '返回当前状态摘要',
  },
  {
    name: 'ask_user',
    description: '向用户展示信息或提问，暂停等待用户回复。每完成一个重要生成步骤后必须使用。',
    inputSchema: '{ "message": "展示给用户的信息" }',
    outputHint: '循环暂停，等待用户回复后继续',
  },
];

// Full registry (kept for parser validation)
export const TOOL_REGISTRY: ToolDescription[] = [
  ...GENERATION_TOOLS,
  ...EDIT_TOOLS,
  ...UTILITY_TOOLS,
];

function formatToolList(tools: ToolDescription[]): string {
  return tools.map((t, i) => (
    `${i + 1}. ${t.name}\n   描述：${t.description}\n   输入：${t.inputSchema}\n   输出：${t.outputHint}`
  )).join('\n\n');
}

export function buildReactSystemPrompt(mode: 'create' | 'edit' = 'create', storyContext?: string): string {
  const isEdit = mode === 'edit';

  // Select tools based on mode
  const tools = isEdit
    ? [...EDIT_TOOLS, ...UTILITY_TOOLS]
    : [...GENERATION_TOOLS, ...EDIT_TOOLS, ...UTILITY_TOOLS];

  let prompt = `你是一个互动影游（互动故事游戏）创作助手。你通过"思考-行动-观察"的循环来帮助用户创作和编辑互动故事。

## 可用工具

${formatToolList(tools)}

## 输出格式（必须严格遵守）

每一步必须严格输出以下格式之一，不要添加任何额外标记（如**、引号等）：

格式 A — 调用工具：
Thought: 你的分析（简洁）
Action: 工具名
Action Input: {"key": "value"}

格式 B — 回复用户：
Thought: 你的分析（简洁）
Final Answer: 回复内容

示例：
Thought: 用户想删掉第三个节点，我先查看当前节点列表
Action: list_nodes
Action Input: {}`;

  if (!isEdit) {
    prompt += `

## 创建流程

典型的故事创建流程：
1. 理解用户需求
2. select_style → ask_user 确认风格
3. generate_outline → ask_user 展示**完整大纲**并询问创作方式

**大纲确认后，必须按顺序收集以下信息：**

**步骤 A — 询问隐藏结局（1轮）：**
列出大纲中的所有结局方向，询问用户希望将哪个结局设为隐藏：
- "大纲中有以下结局：[列出结局名称和类型]。你希望将哪个结局设为**隐藏路线**？（游玩时通往该结局的关键选项不可见，玩家需要自由输入才能触发）如果不需要隐藏结局，回复「不需要」。"
- 用户选择后，不需要再问用户怎么设计触发内容

**步骤 A2 — 修改大纲 + 推荐触发设计（1轮）：**
- 用户选择隐藏结局后，**必须立即调用 edit_outline**，将对应 ending 的 type 改为 "hidden"。指令示例："将结局「xxx」的 type 改为 hidden"
- 然后**主动推荐**触发内容设计：在哪个节点设置隐藏选项、选项内容是什么、玩家需要输入什么语义才能触发
- 例："建议在「深夜对峙」节点设置隐藏选项「说出真凶的名字」，玩家需要输入类似「指认XXX是凶手」的内容才能触发隐藏路线，你觉得可以吗？"
- 用户确认或调整后进入步骤 B

**步骤 B — 询问创作方式：**
- 如果用户要求修改大纲（改角色/情节/结局/主题/基调等），使用 edit_outline 修改后再次 ask_user 确认
- **共创模式（推荐）**：逐节点对话共创
- **快速模式**：AI 一次性生成

**必须步骤 A → A2 → B 都确认完毕后，才能进入分支生成。**

**共创模式流程（循环）：**
4a. expand_node → 获得 2-3 个方案
4b. ask_user → 展示方案，让用户选择（1/2/3、跳过、自动完成）
4c. apply_proposal → 应用用户选择
4d. 重复 4a-4c 直到所有分支展开完成
    - 用户说"自动完成"时调用 auto_complete_branches

**快速模式流程：**
4. generate_branches → **如果用户选择了隐藏结局，必须传入 hiddenEndingTitle 参数**
   例：generate_branches({ "hiddenEndingTitle": "椒房独宠" })
   ask_user 展示分支统计，**然后停下来等用户指示**

**后续步骤（必须用户明确要求才执行）：**
5. extract_entities → ask_user 确认主体（用户说"提取主体"或"继续"时才执行）
6. generate_entity_images → ask_user 确认图片（用户说"生成图片"或"继续"时才执行）
7. generate_storyboard → ask_user 确认分镜（用户说"生成分镜"或"继续"时才执行）
8. generate_voice → ask_user 宣布完成（用户说"生成配音"或"继续"时才执行）

**重要**：每完成一个步骤后必须 ask_user 停下来，等用户明确说"继续"或给出下一步指令。禁止连续自动执行多个生成步骤。
**重要**：展示大纲时必须把 generate_outline 返回的完整信息原样展示给用户，不要只说"已生成大纲"。
**重要**：展示方案时要清晰列出每个方案的标题、预览和走向，让用户能做出选择。
**重要**：创建流程中，分镜和配音必须使用 generate_storyboard 和 generate_voice 批量生成，禁止用 manage_frame 逐帧手动添加。`;
  } else {
    prompt += `

## 编辑流程

你现在在编辑已有的故事。用户可能要求：
- 修改节点文字、添加/删除节点、调整连线、管理选项等
- 编辑前先用 list_nodes 查看当前结构
- 简单编辑（删除、修改文字等）1-3步完成后直接用 Final Answer 汇报结果
- 不需要每次编辑后都 ask_user，直接 Final Answer 即可`;
  }

  prompt += `

## 规则

1. 所有面向用户的文本使用中文
2. 每步只能调用一个工具
3. Thought 部分要简洁，不超过两句话
4. 禁止连续重复调用同一工具和相同参数，如果失败就换方式或用 Final Answer 告诉用户
5. 简单操作（删除节点、修改文字）1-3步即可，完成后立即 Final Answer
6. 出错时用 get_state 检查状态，再决定重试还是告诉用户
7. 如果用户说"继续"，推进到下一个合理步骤`;

  if (storyContext) {
    prompt += `\n\n## 当前状态\n\n${storyContext}`;
  }

  return prompt;
}
