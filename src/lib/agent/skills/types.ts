import { z } from 'zod';

export interface SkillDefinition<TInput = any, TOutput = any> {
  /** Unique skill identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /** System prompt (static string) */
  systemPrompt: string;

  /** User prompt builder — takes typed input, returns user message string */
  buildUserMessage: (input: TInput) => string;

  /** Zod schema for validating LLM output */
  outputSchema: z.ZodType<TOutput>;

  /** Compact JSON structure example, injected in retry prompt as hint */
  outputExample: string;

  /** LLM call configuration */
  config: {
    temperature: number;
    maxTokens: number;
    /** Request json_object mode from DeepSeek (ensures syntactically valid JSON) */
    jsonMode: boolean;
    /** Skip JSON parsing entirely — for free-text output like chat */
    freeText?: boolean;
  };
}
