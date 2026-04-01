import { PRESET_STYLES, type StyleConfirmInput, type StyleConfirmOutput } from '../types';
import { STYLE_CONFIRM_SYSTEM_PROMPT, STYLE_CONFIRM_USER_PROMPT } from '../prompts/style';

export async function runStyleConfirm(input: StyleConfirmInput): Promise<StyleConfirmOutput> {
  // In production: call Claude API with STYLE_CONFIRM_SYSTEM_PROMPT
  // For now: auto-recommend based on keywords
  const desc = input.storyDescription.toLowerCase();

  let bestStyle = PRESET_STYLES[0]; // default: cinematic

  if (desc.includes('仙') || desc.includes('古') || desc.includes('武侠') || desc.includes('国风')) {
    bestStyle = PRESET_STYLES.find((s) => s.styleId === 'ink_wash')!;
  } else if (desc.includes('科幻') || desc.includes('未来') || desc.includes('赛博') || desc.includes('AI')) {
    bestStyle = PRESET_STYLES.find((s) => s.styleId === 'cyberpunk')!;
  } else if (desc.includes('校园') || desc.includes('动漫') || desc.includes('青春')) {
    bestStyle = PRESET_STYLES.find((s) => s.styleId === 'anime')!;
  } else if (desc.includes('恐怖') || desc.includes('暗黑') || desc.includes('悬疑')) {
    bestStyle = PRESET_STYLES.find((s) => s.styleId === 'dark_gothic')!;
  } else if (desc.includes('温馨') || desc.includes('童话') || desc.includes('治愈')) {
    bestStyle = PRESET_STYLES.find((s) => s.styleId === 'watercolor')!;
  }

  return {
    style: bestStyle,
    previewPrompt: `${bestStyle.stylePromptPrefix}story scene preview, ${input.storyDescription}`,
  };
}
