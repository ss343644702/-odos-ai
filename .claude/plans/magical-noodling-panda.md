# 故事配置节点（Story Config Node）

## Context

用户希望在画布上有一个特殊的"故事配置"节点，集中展示和管理故事的全局设定（风格、大纲、主体、音色）。当前这些数据分散在 chatStore.orchestrator 中，无法在画布上直观查看和编辑。

---

## 设计方案

### 节点外观

在画布左上角，故事树根节点的上方，显示一个特殊的"故事配置"节点：
- 外观：紫色边框，图标用 ⚙️，标题显示故事名
- 不参与故事流程（无 source/target handle 连线）
- 创建故事后自动出现，始终存在
- 点击后右侧打开专属的 StoryConfigPanel（替代普通 ParameterPanel）

### 参数面板 UI — 折叠分区 + Tab

面板采用**可折叠分区（Accordion）**布局，每个区域独立展开/收起：

#### 1. 画面风格（只读）
- 显示风格名称 + 色调 + 光影风格
- 小字显示 stylePromptPrefix（灰色）

#### 2. 剧本大纲（只读）
- 主题 + 基调 + 层数 + 结局数
- 角色列表（name + role，一行一个）
- 情节要点（折叠，点击展开）
- 结局列表（类型标签 + 标题）

#### 3. 主体管理（可编辑）— Tab 切换：角色 | 场景 | 道具
每个 tab 下显示实体卡片列表，每张卡片：
- 缩略图（64x64 圆角）+ 名称 + 描述
- 展开后：imagePrompt 可编辑 textarea
- 操作按钮：「重新生成图片」（单个）
- 修改 imagePrompt 后自动同步到 chatStore.entities

#### 4. 音色配置（可编辑）
- 显示"旁白"固定行 + 所有角色行
- 每行：角色名 + 当前 voiceType 下拉选择器
- voiceType 选项：narrator/young_male/mature_male/young_female/mature_female/elder/child
- 修改后：更新 chatStore.entities 中角色的 voiceType
- 「重新生成全部配音」按钮 → 调用 runVoiceGeneration

---

## 实现方案

### Task 1: 类型扩展

**修改 `src/types/story.ts`**:
- `NodeType` 新增 `'story_config'`
- 新增 `StoryConfigData` 接口（或复用 StoryNodeData，config 节点仅用 title + metadata）

### Task 2: 自动创建配置节点

**修改 `src/components/creator/AgentChat.tsx`**:
- `runBranchGeneration()` 完成后，在 `setNodesAndEdges` 之前，插入一个 `story_config` 节点
- 位置：故事树根节点的上方（x 相同，y 减 150）
- 该节点不参与 layout 计算

### Task 3: 画布节点渲染

**修改 `src/components/creator/StoryNode.tsx`**:
- `nodeColors` 添加 `story_config: 'var(--accent)'`
- `nodeLabels` 添加 `story_config: '故事配置'`
- `story_config` 类型渲染特殊外观：无缩略图区域，显示 ⚙️ 图标 + 故事标题 + 风格/节点数等摘要
- 无 source/target handle

### Task 4: 配置面板组件

**新建 `src/components/creator/StoryConfigPanel.tsx`**:

```
<StoryConfigPanel>
  ├── Header: "故事配置" + 关闭按钮
  ├── Section: 画面风格（只读）
  │   └── 风格名 / 色调 / 光影 / promptPrefix
  ├── Section: 剧本大纲（只读）
  │   └── 主题 / 基调 / 角色列表 / 情节要点 / 结局
  ├── Section: 主体管理（可编辑）
  │   ├── Tab: 角色 | 场景 | 道具
  │   └── EntityCard × N（缩略图 + 名称 + imagePrompt编辑 + 重新生成）
  └── Section: 音色配置（可编辑）
      └── VoiceRow × N（角色名 + voiceType下拉）+ 重新生成按钮
```

数据来源：
- 风格/大纲/主体 → `useChatStore` 的 orchestrator
- 音色 → orchestrator.entities.characters 的 voiceType 字段（需扩展 Character 类型）

### Task 5: 面板路由

**修改 `src/components/creator/ParameterPanel.tsx`**:
- 检查 `node.type === 'story_config'`，如果是，渲染 `<StoryConfigPanel />` 替代普通面板

### Task 6: 主体编辑联动

**StoryConfigPanel 中的编辑操作**:
- 修改 imagePrompt → `useChatStore.getState().updateEntityImage` 系列（需新增 updateEntityPrompt）
- 重新生成图片 → 调用 `/api/generate-image`，轮询，成功后 `updateEntityImage`
- 修改 voiceType → 更新 entities.characters[i].voiceType（需新增 store method）

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `src/types/story.ts` | 修改 — NodeType 新增 `story_config`，Character 新增 `voiceType` |
| `src/components/creator/StoryConfigPanel.tsx` | **新建** — 故事配置面板组件 |
| `src/components/creator/StoryNode.tsx` | 修改 — 新增 story_config 节点渲染 |
| `src/components/creator/ParameterPanel.tsx` | 修改 — story_config 时渲染 StoryConfigPanel |
| `src/components/creator/AgentChat.tsx` | 修改 — 分支生成后自动创建 config 节点 |
| `src/stores/chatStore.ts` | 修改 — 新增 updateEntityPrompt、updateCharacterVoice 方法 |

## 实现顺序

1. 类型扩展（story.ts）
2. Store 方法（chatStore.ts）
3. StoryConfigPanel 组件
4. StoryNode 渲染扩展
5. ParameterPanel 路由
6. AgentChat 自动创建 config 节点

## 验证

1. 创建故事 → 分支生成后画布出现紫色"故事配置"节点
2. 点击配置节点 → 右侧打开 StoryConfigPanel
3. 画面风格/大纲区域只读显示正确
4. 主体管理：切换 tab 查看角色/场景/道具，编辑 imagePrompt 并重新生成图片
5. 音色配置：修改角色 voiceType 下拉，确认数据同步
