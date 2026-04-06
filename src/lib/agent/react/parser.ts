import type { ReactStepResult, ToolName } from './types';

const VALID_TOOLS: Set<string> = new Set([
  'select_style', 'generate_outline', 'generate_branches',
  'expand_node', 'apply_proposal', 'auto_complete_branches',
  'extract_entities', 'generate_entity_images', 'generate_storyboard',
  'generate_voice', 'edit_node', 'manage_node', 'manage_edge',
  'manage_choice', 'manage_frame', 'list_nodes', 'edit_outline',
  'reset_story', 'get_state', 'ask_user',
]);

/** Clean up a tool name by removing common LLM formatting artifacts */
function cleanToolName(raw: string): string {
  return raw
    .trim()
    .replace(/^\*+|\*+$/g, '')   // **tool** → tool
    .replace(/["""''`]/g, '')     // "tool" → tool
    .replace(/[.,;:!?]+$/, '');   // tool. → tool
}

/**
 * Parse ReAct-format LLM output into structured result.
 *
 * Expected formats:
 *   Thought: <reasoning>
 *   Action: <tool_name>
 *   Action Input: <json>
 *
 * OR:
 *   Thought: <reasoning>
 *   Final Answer: <message>
 */
export function parseReactOutput(raw: string): ReactStepResult {
  const trimmed = raw.trim();

  // Extract Thought (everything between "Thought:" and "Action:"/"Final Answer:")
  const thoughtMatch = trimmed.match(
    /Thought:\s*([\s\S]*?)(?=\n\s*(?:Action:|Final Answer:)|$)/i,
  );
  const thought = thoughtMatch?.[1]?.trim() || '';

  // Check for Final Answer
  const finalMatch = trimmed.match(/Final Answer:\s*([\s\S]*?)$/i);
  if (finalMatch) {
    return { thought, finalAnswer: finalMatch[1].trim() };
  }

  // Check for Action + Action Input
  const actionMatch = trimmed.match(/Action:\s*(\S+)/i);
  const inputMatch = trimmed.match(/Action Input:\s*([\s\S]*?)$/i);

  if (actionMatch) {
    const toolName = cleanToolName(actionMatch[1]);
    if (VALID_TOOLS.has(toolName)) {
      let input: Record<string, unknown> = {};
      if (inputMatch) {
        try {
          const jsonStr = inputMatch[1].trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, '');
          input = JSON.parse(jsonStr);
        } catch {
          input = { raw: inputMatch[1].trim() };
        }
      }
      return { thought, action: { tool: toolName as ToolName, input } };
    }
  }

  // Fallback: brute-force search for any known tool name in the text
  // Helps when LLM uses slightly different formatting
  for (const validTool of VALID_TOOLS) {
    if (trimmed.includes(validTool)) {
      const afterTool = trimmed.split(validTool).pop() || '';
      const jsonMatch = afterTool.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const input = JSON.parse(jsonMatch[0]);
          return { thought, action: { tool: validTool as ToolName, input } };
        } catch {
          // JSON parse failed, use empty input
        }
      }
      return { thought, action: { tool: validTool as ToolName, input: {} } };
    }
  }

  // Last resort: treat entire output as final answer
  return {
    thought: '',
    finalAnswer: trimmed || '(空响应)',
  };
}

/** Check if a partial streaming response has completed the Thought phase */
export function isThoughtComplete(partial: string): boolean {
  return /\n\s*(Action:|Final Answer:)/i.test(partial);
}
