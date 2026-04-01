/**
 * StoryCommand — structured mutations that tools emit.
 * The server-side LangGraph tools return these commands instead of calling Zustand directly.
 * The client receives them via SSE and applies them to Zustand stores.
 */

import type {
  StoryNode, StoryEdge, StoryNodeData, Choice, Frame,
  StyleConfig, StoryOutline, EntityCollection, Story,
} from '@/types/story';
import type { SkillName, InteractiveBranchState, PendingExpansion } from '@/lib/agent/types';

// ── Style ──
interface SetStyleCmd { type: 'SET_STYLE'; payload: StyleConfig }

// ── Outline ──
interface SetOutlineCmd { type: 'SET_OUTLINE'; payload: StoryOutline }
interface SetWorldViewCmd { type: 'SET_WORLD_VIEW'; payload: string }
interface SetStoryDescriptionCmd { type: 'SET_STORY_DESCRIPTION'; payload: string }

// ── Entities ──
interface SetEntitiesCmd { type: 'SET_ENTITIES'; payload: EntityCollection }
interface UpdateEntityImageCmd {
  type: 'UPDATE_ENTITY_IMAGE';
  payload: { entityType: 'characters' | 'scenes' | 'props'; id: string; imageUrl: string };
}
interface UpdateEntityFieldCmd {
  type: 'UPDATE_ENTITY_FIELD';
  payload: { entityType: 'characters' | 'scenes' | 'props'; id: string; field: string; value: unknown };
}

// ── Nodes — batch ──
interface SetNodesAndEdgesCmd { type: 'SET_NODES_AND_EDGES'; payload: { nodes: StoryNode[]; edges: StoryEdge[] } }
interface AddNodesAndEdgesCmd { type: 'ADD_NODES_AND_EDGES'; payload: { nodes: StoryNode[]; edges: StoryEdge[] } }

// ── Nodes — single ──
interface AddNodeCmd { type: 'ADD_NODE'; payload: StoryNode }
interface UpdateNodeCmd { type: 'UPDATE_NODE'; payload: { nodeId: string; data: Partial<StoryNodeData> } }
interface RemoveNodeCmd { type: 'REMOVE_NODE'; payload: { nodeId: string } }
interface UpdateNodePositionCmd { type: 'UPDATE_NODE_POSITION'; payload: { nodeId: string; position: { x: number; y: number } } }

// ── Edges ──
interface AddEdgeCmd { type: 'ADD_EDGE'; payload: StoryEdge }
interface RemoveEdgeCmd { type: 'REMOVE_EDGE'; payload: { edgeId: string } }

// ── Choices ──
interface AddChoiceCmd { type: 'ADD_CHOICE'; payload: { nodeId: string; choice: Choice } }
interface UpdateChoiceCmd { type: 'UPDATE_CHOICE'; payload: { nodeId: string; choiceId: string; updates: Partial<Choice> } }
interface RemoveChoiceCmd { type: 'REMOVE_CHOICE'; payload: { nodeId: string; choiceId: string } }

// ── Frames ──
interface AddFrameCmd { type: 'ADD_FRAME'; payload: { nodeId: string; frame: Frame } }
interface UpdateFrameCmd { type: 'UPDATE_FRAME'; payload: { nodeId: string; frameId: string; updates: Partial<Frame> } }
interface RemoveFrameCmd { type: 'REMOVE_FRAME'; payload: { nodeId: string; frameId: string } }

// ── Orchestrator ──
interface SetSkillStatusCmd { type: 'SET_SKILL_STATUS'; payload: { skill: SkillName; status: string } }
interface SetCurrentSkillCmd { type: 'SET_CURRENT_SKILL'; payload: SkillName | null }

// ── Interactive Branch ──
interface SetInteractiveBranchCmd { type: 'SET_INTERACTIVE_BRANCH'; payload: Partial<InteractiveBranchState> }
interface AddPendingExpansionCmd { type: 'ADD_PENDING_EXPANSION'; payload: PendingExpansion }
interface RemovePendingExpansionCmd { type: 'REMOVE_PENDING_EXPANSION'; payload: { parentNodeId: string; choiceId: string } }
interface ClearInteractiveBranchCmd { type: 'CLEAR_INTERACTIVE_BRANCH' }

// ── Story-level ──
interface InitStoryCmd { type: 'INIT_STORY'; payload: { title: string; description: string } }
interface SetStoryCmd { type: 'SET_STORY'; payload: Story }
interface UpdateSettingsCmd { type: 'UPDATE_SETTINGS'; payload: Partial<Story['settings']> }

// ── Reset ──
interface ResetStoryCmd { type: 'RESET_STORY' }

export type StoryCommand =
  | SetStyleCmd
  | SetOutlineCmd
  | SetWorldViewCmd
  | SetStoryDescriptionCmd
  | SetEntitiesCmd
  | UpdateEntityImageCmd
  | UpdateEntityFieldCmd
  | SetNodesAndEdgesCmd
  | AddNodesAndEdgesCmd
  | AddNodeCmd
  | UpdateNodeCmd
  | RemoveNodeCmd
  | UpdateNodePositionCmd
  | AddEdgeCmd
  | RemoveEdgeCmd
  | AddChoiceCmd
  | UpdateChoiceCmd
  | RemoveChoiceCmd
  | AddFrameCmd
  | UpdateFrameCmd
  | RemoveFrameCmd
  | SetSkillStatusCmd
  | SetCurrentSkillCmd
  | SetInteractiveBranchCmd
  | AddPendingExpansionCmd
  | RemovePendingExpansionCmd
  | ClearInteractiveBranchCmd
  | InitStoryCmd
  | SetStoryCmd
  | UpdateSettingsCmd
  | ResetStoryCmd;
