'use client';

import type { Choice } from '@/types/story';

interface ChoicePanelProps {
  choices: Choice[];
  onChoose: (choiceId: string) => void;
}

export default function ChoicePanel({ choices, onChoose }: ChoicePanelProps) {
  if (!choices || choices.length === 0) return null;

  return (
    <div className="space-y-2">
      {choices.map((choice, i) => (
        <button
          key={choice.id}
          onClick={() => onChoose(choice.id)}
          className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="text-xs font-medium mr-2" style={{ color: 'var(--accent)' }}>
            {String.fromCharCode(65 + i)}.
          </span>
          {choice.text}
        </button>
      ))}
    </div>
  );
}
