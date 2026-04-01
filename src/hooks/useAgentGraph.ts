'use client';

import { useState, useRef, useCallback, MutableRefObject } from 'react';
import { v4 as uuid } from 'uuid';
import type { ReactLoopStatus, ToolName } from '@/lib/agent/react/types';
import type { SkillName } from '@/lib/agent/types';
import { buildStoryContext } from '@/lib/agent/graph/buildContext';
import { applyCommand } from '@/lib/agent/graph/applyCommand';
import type { StoryCommand } from '@/lib/agent/graph/commands';
import { useChatStore } from '@/stores/chatStore';

export type AgentMode = 'create' | 'edit';

/** Map tool names to pipeline skill names for progress bar updates */
const TOOL_TO_SKILL: Partial<Record<string, SkillName>> = {
  select_style: 'styleConfirm',
  generate_outline: 'outlineGenerator',
  generate_branches: 'branchGenerator',
  expand_node: 'branchGenerator',
  apply_proposal: 'branchGenerator',
  auto_complete_branches: 'branchGenerator',
  extract_entities: 'entityExtractor',
  generate_storyboard: 'storyboardGenerator',
  generate_voice: 'voiceGenerator',
};

/** Tools that manage their own progress — don't auto-complete skill */
const NO_AUTO_COMPLETE = new Set(['expand_node', 'apply_proposal']);

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

/** Read SSE events from a fetch Response */
async function* readSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;
      try {
        yield JSON.parse(dataStr);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  // Flush remaining buffer after stream ends
  buffer += decoder.decode(); // finalize decoder
  if (buffer.trim()) {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr) continue;
      try {
        yield JSON.parse(dataStr);
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

/** Flush tokenBuffer to chat store */
function flushTokenBuffer(tokenBuffer: string) {
  if (!tokenBuffer) return;
  const store = useChatStore.getState();
  const msgs = store.messages;
  if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
    store.updateLastAssistantMessage(tokenBuffer);
  } else {
    store.addMessage({ role: 'assistant', content: tokenBuffer });
  }
}

export function useAgentGraph() {
  const [status, setStatusRaw] = useState<ReactLoopStatus>('idle');
  const [currentThought, setCurrentThought] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<ToolName | null>(null);

  // Synchronous ref mirrors status for race-free reads from callbacks
  const statusRef = useRef<ReactLoopStatus>('idle');
  const setStatus = useCallback((s: ReactLoopStatus) => {
    statusRef.current = s;
    setStatusRaw(s);
  }, []);

  const threadIdRef = useRef<string>(uuid());
  const abortRef = useRef<AbortController | null>(null);
  const modeRef = useRef<AgentMode>('create');

  /** Core invoke: send request and process SSE stream */
  const invokeGraph = useCallback(async (params: {
    message: string;
  }) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { setReactLoopActive } = useChatStore.getState();
    setReactLoopActive(true);

    // Accumulate LLM text tokens for the final message
    let tokenBuffer = '';

    try {
      const storyContext = buildStoryContext(true);
      const ib = useChatStore.getState().orchestrator.interactiveBranch;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadIdRef.current,
          message: params.message,
          storyContext,
          interactiveBranch: ib,
          mode: modeRef.current,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      for await (const event of readSSEStream(res)) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'token': {
            setStatus('thinking');
            tokenBuffer += (event.text as string) || '';
            // Stream tokens to the last assistant message
            flushTokenBuffer(tokenBuffer);
            break;
          }

          case 'tool_start': {
            const toolName = event.tool as string;
            setStatus('acting');
            setCurrentTool(toolName as ToolName);

            // Flush any accumulated token buffer as a finalized message
            if (tokenBuffer) {
              flushTokenBuffer(tokenBuffer);
              // Start a new message for the tool progress
              useChatStore.getState().addMessage({
                role: 'assistant',
                content: `⚡ 执行: ${toolName}...`,
                reactTool: toolName as ToolName,
              });
              tokenBuffer = '';
            } else {
              useChatStore.getState().addMessage({
                role: 'assistant',
                content: `⚡ 执行: ${toolName}...`,
                reactTool: toolName as ToolName,
              });
            }

            // Update skill progress
            const skill = TOOL_TO_SKILL[toolName];
            if (skill) {
              useChatStore.getState().updateSkillStatus(skill, 'running');
              useChatStore.getState().setCurrentSkill(skill);
            }
            break;
          }

          case 'tool_end': {
            const toolName = event.tool as string;
            const result = event.result as string;

            // Update last message with result
            useChatStore.getState().updateLastAssistantMessage(
              `✅ ${toolName}: ${typeof result === 'string' ? result.slice(0, 200) : 'done'}`
            );

            // Mark skill completed
            const skill = TOOL_TO_SKILL[toolName];
            if (skill && !NO_AUTO_COMPLETE.has(toolName)) {
              useChatStore.getState().updateSkillStatus(skill, 'completed');
            }
            setCurrentTool(null);
            break;
          }

          case 'command': {
            // Apply command to Zustand stores
            if (event.command) {
              applyCommand(event.command as StoryCommand);
            }
            break;
          }

          case 'done':
            // Flush any remaining tokens
            if (tokenBuffer) {
              flushTokenBuffer(tokenBuffer);
              tokenBuffer = '';
            }
            setStatus('done');
            break;

          case 'error':
            useChatStore.getState().addMessage({
              role: 'assistant',
              content: `❌ 错误: ${event.message}`,
            });
            setStatus('error');
            return;
        }
      }

      setStatus('idle');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      console.error('[useAgentGraph] error:', err);
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: `❌ Agent 错误: ${err.message}`,
      });
      setStatus('error');
    } finally {
      useChatStore.getState().setReactLoopActive(false);
      abortRef.current = null;
    }
  }, []); // No deps — reads everything from refs/stores

  /** Start a brand new story session (new threadId) */
  const startNewStory = useCallback(async (userMessage: string, mode: AgentMode = 'create') => {
    // New session = new thread
    threadIdRef.current = uuid();
    modeRef.current = mode;

    // Reset skill progress
    const { orchestrator, updateSkillStatus, setCurrentSkill } = useChatStore.getState();
    orchestrator.skills.forEach((s) => updateSkillStatus(s.name, 'idle'));
    setCurrentSkill(null);

    await invokeGraph({ message: userMessage });
  }, [invokeGraph]);

  /** Send a message within the current session (same threadId) */
  const sendMessage = useCallback(async (userMessage: string, mode?: AgentMode) => {
    if (mode) modeRef.current = mode;
    await invokeGraph({ message: userMessage });
  }, [invokeGraph]);

  /** Abort the current execution */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setCurrentThought(null);
    setCurrentTool(null);
  }, []);

  return {
    status,
    statusRef,
    currentThought,
    currentTool,
    startNewStory,
    sendMessage,
    abort,
  };
}
