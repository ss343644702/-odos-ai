'use client';

import { useState, useRef, useCallback } from 'react';
import type { ReactLoopStatus, ToolName, ReactModelConfig, ToolContext } from '@/lib/agent/react/types';
import { DEFAULT_REACT_CONFIG } from '@/lib/agent/react/types';
import { parseReactOutput } from '@/lib/agent/react/parser';
import { buildReactSystemPrompt } from '@/lib/agent/react/prompt';
import { TOOL_EXECUTORS } from '@/lib/agent/react/tools';
import { ReactHistory } from '@/lib/agent/react/history';
import { useChatStore } from '@/stores/chatStore';
import type { SkillName } from '@/lib/agent/types';

/** Map ReAct tool names to pipeline skill names for progress bar updates */
const TOOL_TO_SKILL: Partial<Record<ToolName, SkillName>> = {
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

export type AgentMode = 'create' | 'edit';

export function useReactLoop(config?: Partial<ReactModelConfig>) {
  const modelConfig = { ...DEFAULT_REACT_CONFIG, ...config };

  const [status, setStatus] = useState<ReactLoopStatus>('idle');
  const [currentThought, setCurrentThought] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<ToolName | null>(null);

  const historyRef = useRef(new ReactHistory());
  const abortRef = useRef<AbortController | null>(null);

  // Anti-loop refs (persist across resume)
  const turnCountRef = useRef(0);
  const parseErrorCountRef = useRef(0);
  const lastActionsRef = useRef<string[]>([]);
  const turnsSinceUserRef = useRef(0);
  const modeRef = useRef<AgentMode>('create');

  const { addMessage, setReactLoopActive } = useChatStore.getState();

  /** Call the ReAct step API */
  const callReactStep = useCallback(async (
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
  ): Promise<string> => {
    const res = await fetch('/api/react-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        modelConfig: {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
          model: modelConfig.modelId,
        },
      }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'API error' }));
      throw new Error(err.error || `API error ${res.status}`);
    }
    const data = await res.json();
    return data.content;
  }, [modelConfig]);

  /** Run the ReAct loop */
  const runLoop = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setReactLoopActive(true);

    try {
      while (turnCountRef.current < modelConfig.maxTurns) {
        if (controller.signal.aborted) break;
        turnCountRef.current++;

        // 1. Think
        setStatus('thinking');
        setCurrentThought(null);
        setCurrentTool(null);

        const systemPrompt = buildReactSystemPrompt(modeRef.current);
        const messages = historyRef.current.buildMessages(systemPrompt);

        let raw: string;
        try {
          raw = await callReactStep(messages, controller.signal);
        } catch (err: any) {
          if (err.name === 'AbortError') break;
          useChatStore.getState().addMessage({
            role: 'assistant',
            content: `❌ 推理出错：${err.message}`,
          });
          setStatus('error');
          return;
        }

        // 2. Parse
        const step = parseReactOutput(raw);
        setCurrentThought(step.thought);

        // 3. Handle Final Answer
        if (step.finalAnswer) {
          historyRef.current.addTurn({
            thought: step.thought,
            finalAnswer: step.finalAnswer,
          });
          useChatStore.getState().addMessage({
            role: 'assistant',
            content: step.finalAnswer,
            reactThought: step.thought,
          });
          setStatus('done');
          return;
        }

        // 4. Handle Action
        if (step.action) {
          parseErrorCountRef.current = 0;
          const { tool, input } = step.action;
          setStatus('acting');
          setCurrentTool(tool);

          // --- Anti-loop: repeated action detection ---
          const actionKey = `${tool}:${JSON.stringify(input)}`;
          lastActionsRef.current.push(actionKey);
          if (lastActionsRef.current.length > 3) lastActionsRef.current.shift();

          if (
            lastActionsRef.current.length === 3 &&
            lastActionsRef.current.every((a) => a === actionKey)
          ) {
            useChatStore.getState().addMessage({
              role: 'assistant',
              content: '⚠️ 检测到重复操作，已自动停止。请告诉我你需要什么帮助。',
            });
            setStatus('done');
            return;
          }

          // Add progress message
          useChatStore.getState().addMessage({
            role: 'assistant',
            content: `⚡ 执行: ${tool}...`,
            reactThought: step.thought,
            reactTool: tool,
          });

          // Special case: ask_user pauses the loop
          if (tool === 'ask_user') {
            const message = (input.message as string) || '请确认是否继续';
            useChatStore.getState().updateLastAssistantMessage(message);
            historyRef.current.addTurn({
              thought: step.thought,
              action: step.action,
              observation: '[等待用户回复]',
            });
            turnsSinceUserRef.current = 0;
            setStatus('waiting_user');
            setCurrentTool(null);
            return;
          }

          // Update skill progress bar
          const mappedSkill = TOOL_TO_SKILL[tool];
          if (mappedSkill) {
            useChatStore.getState().updateSkillStatus(mappedSkill, 'running');
            useChatStore.getState().setCurrentSkill(mappedSkill);
          }

          // Execute tool
          const toolCtx: ToolContext = {
            addMessage: (msg) => useChatStore.getState().addMessage(msg as any),
            updateMessage: (content) => useChatStore.getState().updateLastAssistantMessage(content),
            signal: controller.signal,
          };

          // Tools that are intermediate steps — don't mark skill as completed
          const NO_AUTO_COMPLETE = new Set<ToolName>(['expand_node', 'apply_proposal']);
          // Tools that manage their own message display — don't overwrite with observation
          const SELF_DISPLAY = new Set<ToolName>(['expand_node', 'generate_outline', 'edit_outline']);

          let observation: string;
          try {
            const executor = TOOL_EXECUTORS[tool];
            if (!executor) throw new Error(`Unknown tool: ${tool}`);
            const result = await executor(input, toolCtx);
            observation = result.result;
            if (!SELF_DISPLAY.has(tool)) {
              useChatStore.getState().updateLastAssistantMessage(
                `✅ ${tool}: ${observation}`,
              );
            }
            if (mappedSkill && !NO_AUTO_COMPLETE.has(tool)) {
              useChatStore.getState().updateSkillStatus(mappedSkill, 'completed');
            }

            // Tools that display proposals and need user input can request a pause
            if ((result.data as any)?._pauseForUser) {
              historyRef.current.addTurn({
                thought: step.thought,
                action: step.action,
                observation,
              });
              turnsSinceUserRef.current = 0;
              setStatus('waiting_user');
              setCurrentTool(null);
              return; // pause loop, wait for user input via resumeLoop
            }
          } catch (err: any) {
            if (err.name === 'AbortError') break;
            observation = `错误: ${err.message}`;
            useChatStore.getState().updateLastAssistantMessage(
              `❌ ${tool}: ${observation}`,
            );
            if (mappedSkill) {
              useChatStore.getState().updateSkillStatus(mappedSkill, 'error');
            }
          }

          historyRef.current.addTurn({
            thought: step.thought,
            action: step.action,
            observation,
          });

          // --- Anti-loop: force pause after too many turns without user interaction ---
          turnsSinceUserRef.current++;
          if (turnsSinceUserRef.current >= 10) {
            useChatStore.getState().addMessage({
              role: 'assistant',
              content: '已连续执行多个步骤，请确认是否继续。',
            });
            turnsSinceUserRef.current = 0;
            setStatus('waiting_user');
            setCurrentTool(null);
            return;
          }

          continue;
        }

        // 5. Parse error fallback
        parseErrorCountRef.current++;
        if (parseErrorCountRef.current >= 2) {
          useChatStore.getState().addMessage({
            role: 'assistant',
            content: raw || '(无法解析响应)',
          });
          setStatus('error');
          return;
        }

        historyRef.current.addTurn({
          thought: step.thought || '(解析失败)',
          observation: '系统提示: 你的输出格式不正确。请严格使用 "Thought:/Action:/Action Input:" 或 "Thought:/Final Answer:" 格式。',
        });
      }

      // Max turns reached — offer to continue
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: `已完成当前阶段的工作并自动保存。如需继续，请输入"继续"或告诉我下一步要做什么。`,
      });
      turnsSinceUserRef.current = 0;
      setStatus('waiting_user');
    } finally {
      setReactLoopActive(false);
      abortRef.current = null;
    }
  }, [callReactStep, modelConfig.maxTurns, setReactLoopActive]);

  /** Start a new ReAct loop with a user message */
  const startLoop = useCallback(async (userMessage: string, mode: AgentMode = 'create') => {
    // Reset all counters
    turnCountRef.current = 0;
    parseErrorCountRef.current = 0;
    lastActionsRef.current = [];
    turnsSinceUserRef.current = 0;
    modeRef.current = mode;

    // Reset skill progress
    const { orchestrator, updateSkillStatus, setCurrentSkill } = useChatStore.getState();
    orchestrator.skills.forEach((s) => updateSkillStatus(s.name, 'idle'));
    setCurrentSkill(null);

    historyRef.current.clear();
    historyRef.current.addUserMessage(userMessage);
    await runLoop();
  }, [runLoop]);

  /** Resume after ask_user or _pauseForUser pause */
  const resumeLoop = useCallback(async (userResponse: string) => {
    // Reset turn counter on user interaction — the limit is per continuous run, not total
    turnCountRef.current = 0;
    historyRef.current.addUserMessage(userResponse);
    // Update the last paused turn's observation with user response context
    const turns = (historyRef.current as any).turns;
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.action?.tool === 'ask_user') {
        const originalQuestion = lastTurn.action.input?.message || '';
        lastTurn.observation = originalQuestion
          ? `[你之前的提问: ${originalQuestion.slice(0, 300)}]\n用户回复: ${userResponse}`
          : `用户回复: ${userResponse}`;
      } else if (lastTurn.observation) {
        // Tool paused for user input (e.g. expand_node with _pauseForUser)
        lastTurn.observation += `\n用户回复: ${userResponse}`;
      }
    }
    await runLoop();
  }, [runLoop]);

  /** Abort the current loop */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setCurrentThought(null);
    setCurrentTool(null);
  }, []);

  return {
    status,
    currentThought,
    currentTool,
    startLoop,
    resumeLoop,
    abort,
  };
}
