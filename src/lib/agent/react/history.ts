import type { ReactTurn } from './types';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Manages the ReAct conversation history with a sliding window
 * to prevent context overflow.
 */
export class ReactHistory {
  private turns: ReactTurn[] = [];
  private userMessages: string[] = [];
  private maxFullTurns: number;
  private maxEstimatedTokens: number;

  constructor(config?: { maxFullTurns?: number; maxEstimatedTokens?: number }) {
    this.maxFullTurns = config?.maxFullTurns ?? 10;
    this.maxEstimatedTokens = config?.maxEstimatedTokens ?? 16000;
  }

  addUserMessage(text: string): void {
    this.userMessages.push(text);
  }

  addTurn(turn: ReactTurn): void {
    this.turns.push(turn);
  }

  /** Build the messages array to send to the LLM */
  buildMessages(systemPrompt: string): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add original user request
    if (this.userMessages.length > 0) {
      messages.push({ role: 'user', content: this.userMessages[0] });
    }

    // Split turns into compressed (old) and full (recent)
    const fullStart = Math.max(0, this.turns.length - this.maxFullTurns);

    // Compress older turns into a summary
    if (fullStart > 0) {
      const summary = this.turns
        .slice(0, fullStart)
        .map((t, i) => {
          const toolInfo = t.action ? t.action.tool : 'reply';
          const isError = t.observation?.startsWith('错误');
          const obsShort = t.observation
            ? t.observation.slice(0, 120) + (t.observation.length > 120 ? '...' : '')
            : '';
          return `${i + 1}. [${isError ? '❌' : '✅'}] ${toolInfo}${obsShort ? ': ' + obsShort : ''}`;
        })
        .join('\n');
      messages.push({
        role: 'assistant',
        content: `[之前的推理摘要]\n${summary}`,
      });
    }

    // Add recent turns in full
    for (let i = fullStart; i < this.turns.length; i++) {
      const turn = this.turns[i];

      // Agent's thought + action
      let agentContent = `Thought: ${turn.thought}`;
      if (turn.action) {
        agentContent += `\nAction: ${turn.action.tool}\nAction Input: ${JSON.stringify(turn.action.input)}`;
      } else if (turn.finalAnswer) {
        agentContent += `\nFinal Answer: ${turn.finalAnswer}`;
      }
      messages.push({ role: 'assistant', content: agentContent });

      // Observation (injected as user message per ReAct convention)
      if (turn.observation) {
        messages.push({ role: 'user', content: `Observation: ${turn.observation}` });
      }
    }

    // Add subsequent user messages (after ask_user pauses)
    for (let i = 1; i < this.userMessages.length; i++) {
      // These are already represented as observations in turns
      // Only add if it's the latest and not yet in a turn
      if (i === this.userMessages.length - 1 && this.turns.length > 0) {
        const lastTurn = this.turns[this.turns.length - 1];
        if (lastTurn.action?.tool === 'ask_user' && !lastTurn.observation?.includes(this.userMessages[i])) {
          messages.push({ role: 'user', content: `Observation: 用户回复: ${this.userMessages[i]}` });
        }
      }
    }

    // Inject completed-steps reminder to prevent LLM from repeating
    if (this.turns.length >= 2) {
      // Only count tools AFTER the last reset_story (if any)
      const lastResetIdx = this.turns.findLastIndex((t) => t.action?.tool === 'reset_story' && t.observation && !t.observation.startsWith('错误'));
      const relevantTurns = lastResetIdx >= 0 ? this.turns.slice(lastResetIdx + 1) : this.turns;
      const completedTools = relevantTurns
        .filter((t) => t.action && t.action.tool !== 'ask_user' && t.observation && !t.observation.startsWith('错误'))
        .map((t) => t.action!.tool);
      if (completedTools.length > 0) {
        // Find the latest user response (from ask_user or _pauseForUser)
        const lastUserMsg = this.userMessages.length > 1
          ? this.userMessages[this.userMessages.length - 1]
          : null;
        const uniqueCompleted = [...new Set(completedTools)];

        // Build explicit next-step hint based on completed tools and user response
        let nextStepHint = '';
        if (lastUserMsg) {
          const lower = lastUserMsg.trim().toLowerCase();
          if (uniqueCompleted.includes('generate_outline') && !uniqueCompleted.includes('generate_branches')) {
            if (lower.includes('快速') || lower === '2' || lower.includes('自动')) {
              nextStepHint = '\n⚠️ 用户已选择【快速模式】。你必须立即调用 generate_branches，禁止重新调用 select_style 或 generate_outline。';
            } else if (lower.includes('共创') || lower === '1' || lower.includes('互动')) {
              nextStepHint = '\n⚠️ 用户已选择【共创模式】。你必须立即调用 expand_node，禁止重新调用 select_style 或 generate_outline。';
            }
          }
        }

        let reminder = `[系统提醒] 已完成的步骤: ${uniqueCompleted.join(', ')}。禁止重复调用这些工具。${nextStepHint}`;
        if (lastUserMsg) {
          reminder += `\n用户最新回复: "${lastUserMsg}"`;
        }
        messages.push({
          role: 'user',
          content: reminder,
        });
      }
    }

    // Trim if over token budget (rough estimate: 1 token ≈ 2 Chinese chars or 4 English chars)
    return this.trimToTokenBudget(messages);
  }

  private trimToTokenBudget(messages: LLMMessage[]): LLMMessage[] {
    const estimateTokens = (msg: LLMMessage) => Math.ceil(msg.content.length / 2);
    let total = messages.reduce((sum, m) => sum + estimateTokens(m), 0);

    // Remove oldest non-system messages if over budget
    while (total > this.maxEstimatedTokens && messages.length > 3) {
      const removed = messages.splice(1, 1)[0]; // Remove after system prompt
      total -= estimateTokens(removed);
    }

    return messages;
  }

  /** Get a compact summary for the get_state tool */
  getSummary(): string {
    if (this.turns.length === 0) return '尚未执行任何步骤';
    return this.turns
      .map((t, i) => {
        const tool = t.action?.tool || 'final_answer';
        const ok = t.observation?.includes('成功') || t.observation?.includes('完成') ? '✅' : '⚡';
        return `${i + 1}. ${ok} ${tool}`;
      })
      .join('\n');
  }

  get turnCount(): number {
    return this.turns.length;
  }

  clear(): void {
    this.turns = [];
    this.userMessages = [];
  }
}
