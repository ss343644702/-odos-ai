// ============================================================
// ReAct Agent Types
// ============================================================

export type ToolName =
  | 'select_style'
  | 'generate_outline'
  | 'generate_branches'
  | 'expand_node'
  | 'apply_proposal'
  | 'auto_complete_branches'
  | 'extract_entities'
  | 'generate_entity_images'
  | 'generate_storyboard'
  | 'generate_voice'
  | 'edit_node'
  | 'manage_node'
  | 'manage_edge'
  | 'manage_choice'
  | 'manage_frame'
  | 'list_nodes'
  | 'reset_story'
  | 'get_state'
  | 'ask_user';

/** Parsed output from a single ReAct LLM step */
export interface ReactStepResult {
  thought: string;
  /** Set when the agent wants to call a tool */
  action?: { tool: ToolName; input: Record<string, unknown> };
  /** Set when the agent wants to reply directly to the user */
  finalAnswer?: string;
}

/** Observation returned by a tool executor */
export interface ToolObservation {
  tool: ToolName;
  success: boolean;
  /** Text summary for the LLM to reason about */
  result: string;
  /** Structured data for UI/store updates (not sent to LLM) */
  data?: unknown;
}

/** A single turn in the ReAct scratchpad */
export interface ReactTurn {
  thought: string;
  action?: { tool: ToolName; input: Record<string, unknown> };
  observation?: string;
  finalAnswer?: string;
}

/** Configuration for the reasoning model — supports swapping models later */
export interface ReactModelConfig {
  modelId: string;
  maxTurns: number;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_REACT_CONFIG: ReactModelConfig = {
  modelId: 'deepseek-chat',
  maxTurns: 30,
  temperature: 0.3,
  maxTokens: 2048,
};

export type ReactLoopStatus =
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'waiting_user'
  | 'done'
  | 'error';

/** Tool description for the system prompt */
export interface ToolDescription {
  name: ToolName;
  description: string;
  inputSchema: string;
  outputHint: string;
}

/** Context passed to each tool executor */
export interface ToolContext {
  addMessage: (msg: { role: string; content: string; reactTool?: string }) => void;
  updateMessage: (content: string) => void;
  signal: AbortSignal;
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolObservation>;

export type AgentMode = 'pipeline' | 'react';
