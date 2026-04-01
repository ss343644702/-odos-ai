'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePlayerStore } from '@/stores/playerStore';
import GameplayView from '@/components/player/GameplayView';
import type { Story } from '@/types/story';

export default function PlayPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const story = usePlayerStore((s) => s.story);
  const initSession = usePlayerStore((s) => s.initSession);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // If already loaded with this story, skip fetch
    if (story?.id === storyId) {
      setLoading(false);
      return;
    }

    const loadStory = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stories/${storyId}`);
        if (!res.ok) throw new Error('Story not found');
        const dbStory = await res.json();

        // Reconstruct Story object from DB format
        const storyData = dbStory.data as any;
        const fullStory: Story = {
          id: dbStory.id,
          title: dbStory.title,
          description: dbStory.description,
          coverImageUrl: dbStory.coverImageUrl,
          authorId: dbStory.authorId,
          status: dbStory.status.toLowerCase() as 'draft' | 'published',
          createdAt: dbStory.createdAt,
          updatedAt: dbStory.updatedAt,
          nodes: storyData.nodes || [],
          edges: storyData.edges || [],
          settings: storyData.settings || { defaultVoice: 'narrator', imageStyle: '', language: 'zh-CN', maxDepth: 5, endingCount: 3 },
          worldView: storyData.worldView || '',
          style: storyData.style || { styleId: '', styleName: '', stylePromptPrefix: '', colorTone: '', lightingStyle: '' },
        };

        initSession(fullStory);
      } catch {
        setError('找不到这个影游');
      }
      setLoading(false);
    };

    loadStory();
  }, [storyId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-4xl opacity-30">🎬</div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{error}</p>
      </div>
    );
  }

  return <GameplayView />;
}
