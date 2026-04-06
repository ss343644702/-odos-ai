'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { useStoryStore } from '@/stores/storyStore';
import { usePlayerStore } from '@/stores/playerStore';
import GameplayView from '@/components/player/GameplayView';

export default function PreviewModal() {
  const previewOpen = useEditorStore((s) => s.previewOpen);
  const setPreviewOpen = useEditorStore((s) => s.setPreviewOpen);

  useEffect(() => {
    if (previewOpen) {
      const currentStory = useStoryStore.getState().story;
      if (currentStory) {
        usePlayerStore.getState().initSession(currentStory);
      }
    }
  }, [previewOpen]);

  if (!previewOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)' }}>
      {/* Close button */}
      <button
        onClick={() => setPreviewOpen(false)}
        className="absolute top-4 right-4 p-2 rounded-full z-10"
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Phone frame */}
      <div
        className="w-[380px] h-[680px] rounded-3xl overflow-hidden overflow-y-auto"
        style={{
          background: 'var(--bg-primary)',
          border: '2px solid var(--border)',
          boxShadow: '0 0 60px rgba(108, 92, 231, 0.15)',
        }}
      >
        <GameplayView isPreview />
      </div>
    </div>
  );
}
