/**
 * LangGraph State Annotation for the story creation agent.
 */

import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type {
  StyleConfig, StoryOutline, EntityCollection,
  StoryNode, StoryEdge,
} from '@/types/story';
import type { InteractiveBranchState, NodeProposal } from '@/lib/agent/types';
import type { StoryCommand } from './commands';

// ── Story context snapshot ──
// Sent by the client at invocation. Updated by tools inline so
// subsequent tools in the same run see fresh data without a client round-trip.
export interface StoryContextSnapshot {
  storyDescription: string;
  style: StyleConfig | null;
  outline: StoryOutline | null;
  entities: EntityCollection | null;

  // Compact node list (for tools that only need metadata)
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    depth: number;
    choiceCount: number;
    frameCount: number;
    hasVoice: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    label: string;
  }>;

  nodeCount: number;
  endingCount: number;
  nodesWithFrames: number;
  nodesWithVoice: number;

  // Full node/edge data — included when editing tools need it.
  // Omitted for lightweight invocations.
  fullNodes?: StoryNode[];
  fullEdges?: StoryEdge[];
}

// ── Graph State ──
export const AgentState = Annotation.Root({
  // LangGraph built-in message list (HumanMessage, AIMessage, ToolMessage)
  ...MessagesAnnotation.spec,

  // Story context snapshot from client
  storyContext: Annotation<StoryContextSnapshot>({
    reducer: (_prev, next) => next, // last-write-wins
    default: () => ({
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
    }),
  }),

  // Accumulated commands for the client to apply to Zustand stores.
  // Reducer appends; each tool run adds its commands to the list.
  commands: Annotation<StoryCommand[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Agent mode: 'create' for new story, 'edit' for modifying existing
  mode: Annotation<'create' | 'edit'>({
    reducer: (_prev, next) => next,
    default: () => 'create' as const,
  }),

  // Turn counter for anti-loop protection
  turnCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // Interactive branch co-creation state (server-side mirror)
  interactiveBranch: Annotation<InteractiveBranchState | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
