/**
 * Content safety and prompt injection protection layer.
 *
 * Two concerns:
 * 1. Input sanitization — prevent prompt injection from player free-text
 * 2. Output moderation — flag unsafe LLM-generated content
 */

// ──────────────────────────────────────────────
// 1. Input sanitization (prompt injection defense)
// ──────────────────────────────────────────────

/** Maximum allowed length for player free-text input */
const MAX_INPUT_LENGTH = 500;

/**
 * Patterns that indicate prompt injection attempts.
 * Covers English and Chinese variants.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction override
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|rules?)/i,
  /忽略(之前|以上|上面|前面|所有)(的)?(指令|提示|规则|要求|设定)/,
  /无视(之前|以上|上面|前面|所有)(的)?(指令|提示|规则|要求|设定)/,
  /不要(遵循|遵守|理会|管)(之前|以上|上面|前面|所有)(的)?(指令|提示|规则|要求)/,

  // Role hijacking
  /you\s+are\s+now\s+(a|an|my)\s/i,
  /act\s+as\s+(a|an|if)\s/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /你(现在|从现在开始)是/,
  /扮演(一个|一位)/,
  /假装你是/,

  // System prompt extraction
  /repeat\s+(your|the)\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i,
  /what\s+(are|is)\s+your\s+(instructions?|rules?|system\s+prompt)/i,
  /输出(你的)?(系统|初始)(提示|指令|prompt)/,
  /告诉我你的(设定|指令|提示词)/,

  // Delimiter injection (trying to close/open XML or markdown blocks)
  /<\/?system>/i,
  /```\s*(system|assistant|user)/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,

  // Jailbreak patterns
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /越狱/,
  /开发者模式/,
];

/**
 * Characters/sequences to strip from user input before embedding in prompts.
 * These can be used to construct injection payloads.
 */
const DANGEROUS_SEQUENCES = [
  '```',      // code block delimiters
  '<|',       // special tokens
  '|>',
  '<<',       // heredoc-style
  '>>',
  '${',       // template literal injection
];

export interface SanitizeResult {
  safe: boolean;
  sanitized: string;
  reason?: string;
}

/**
 * Sanitize player input for safe inclusion in LLM prompts.
 *
 * Steps:
 * 1. Truncate to MAX_INPUT_LENGTH
 * 2. Check for injection patterns
 * 3. Strip dangerous character sequences
 * 4. Wrap in safe delimiters for prompt embedding
 */
export function sanitizePlayerInput(raw: string): SanitizeResult {
  if (!raw || typeof raw !== 'string') {
    return { safe: false, sanitized: '', reason: '输入为空' };
  }

  // Truncate
  let text = raw.trim().slice(0, MAX_INPUT_LENGTH);

  // Check injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        sanitized: '',
        reason: '输入包含不允许的指令内容，请重新输入你的故事选择',
      };
    }
  }

  // Strip dangerous sequences
  for (const seq of DANGEROUS_SEQUENCES) {
    text = text.replaceAll(seq, '');
  }

  // Remove control characters (except normal whitespace)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (text.trim().length < 2) {
    return { safe: false, sanitized: '', reason: '输入内容过短' };
  }

  return { safe: true, sanitized: text };
}

/**
 * Wrap sanitized player input in safe delimiters for prompt embedding.
 * The delimiter makes it hard for the input to escape its designated section.
 */
export function wrapPlayerInput(sanitized: string): string {
  return `<player_input>\n${sanitized}\n</player_input>`;
}

// ──────────────────────────────────────────────
// 2. Output moderation (content safety)
// ──────────────────────────────────────────────

/**
 * Content categories to check.
 * Each has patterns that flag potential issues.
 */
interface ContentFlag {
  category: string;
  severity: 'block' | 'warn';
  pattern: RegExp;
}

const CONTENT_FLAGS: ContentFlag[] = [
  // Block: explicit violence / gore
  { category: 'violence', severity: 'block', pattern: /(?:血肉模糊|肢解|虐杀|活剥|掏出内脏|挖出眼|割喉|斩首)/ },

  // Block: explicit sexual content
  { category: 'sexual', severity: 'block', pattern: /(?:性交|做爱|口交|肛交|阴茎|阴道|射精|高潮|裸体交缠)/ },

  // Block: self-harm / suicide instructions
  { category: 'self_harm', severity: 'block', pattern: /(?:自杀方法|自残方式|如何(自杀|自残)|割腕教程|上吊方法)/ },

  // Block: hate speech / discrimination
  { category: 'hate', severity: 'block', pattern: /(?:杀光|灭族|种族清洗|劣等(民族|人种))/ },

  // Warn: mild violence (allow in context but flag)
  { category: 'mild_violence', severity: 'warn', pattern: /(?:鲜血飞溅|断臂|断腿|血流成河)/ },

  // Warn: suggestive content
  { category: 'suggestive', severity: 'warn', pattern: /(?:撕扯衣服|解开(衣|扣)|脱掉(衣|裤)|身体贴在一起|亲吻脖颈)/ },
];

export interface ModerationResult {
  safe: boolean;
  flags: { category: string; severity: 'block' | 'warn' }[];
}

/**
 * Check LLM output for unsafe content.
 * Returns whether the content should be blocked and any flags found.
 */
export function moderateContent(text: string): ModerationResult {
  if (!text) return { safe: true, flags: [] };

  const flags: ModerationResult['flags'] = [];

  for (const flag of CONTENT_FLAGS) {
    if (flag.pattern.test(text)) {
      flags.push({ category: flag.category, severity: flag.severity });
    }
  }

  const hasBlock = flags.some(f => f.severity === 'block');

  return {
    safe: !hasBlock,
    flags,
  };
}

/**
 * Sanitize LLM output by replacing blocked content with safe alternatives.
 */
export function sanitizeOutput(text: string): string {
  let result = text;

  for (const flag of CONTENT_FLAGS) {
    if (flag.severity === 'block') {
      result = result.replace(flag.pattern, '[内容已过滤]');
    }
  }

  return result;
}
