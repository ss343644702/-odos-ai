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
          const success = t.observation?.includes('成功') || t.observation?.includes('完成');
          const obsShort = t.observation
            ? t.observation.slice(0, 120) + (t.observation.length > 120 ? '...' : '')
            : '';
          return `${i + 1}. [${success ? '✅' : '⚡'}] ${toolInfo}${obsShort ? ': ' + obsShort : ''}`;
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
    if (this.turns.length > 3) {
      const completedTools = this.turns
        .filter((t) => t.action && (t.observation?.includes('成功') || t.observation?.includes('完成')))
        .map((t) => t.action!.tool);
      if (completedTools.length > 0) {
        messages.push({
          role: 'user',
          content: `[系统提醒] 已完成的步骤: ${[...new Set(completedTools)].join(', ')}。请不要重复这些步骤。`,
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
