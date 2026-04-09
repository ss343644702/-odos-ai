'use client';

import type { Choice } from '@/types/story';

interface ChoicePanelProps {
  choices: Choice[];
  onChoose: (choiceId: string) => void;
  showHiddenBadge?: boolean;
}

export default function ChoicePanel({ choices, onChoose, showHiddenBadge }: ChoicePanelProps) {
  if (!choices || choices.length === 0) return null;

  return (
    <div className="space-y-2">
      {choices.map((choice, i) => {
        const isHidden = (choice as any).visibility === 'hidden';
        return (
          <button
            key={choice.id}
            onClick={() => onChoose(choice.id)}
            className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: isHidden && showHiddenBadge ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: `1px solid ${isHidden && showHiddenBadge ? 'var(--accent)' : 'var(--border)'}`,
              opacity: isHidden && showHiddenBadge ? 0.75 : 1,
            }}
          >
            <span className="text-xs font-medium mr-2" style={{ color: 'var(--accent)' }}>
              {String.fromCharCode(65 + i)}.
            </span>
            {choice.text}
            {isHidden && showHiddenBadge && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent)', color: 'white' }}>
                隐藏
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
