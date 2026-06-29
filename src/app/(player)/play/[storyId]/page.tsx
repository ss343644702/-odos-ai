'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePlayerStore } from '@/stores/playerStore';
import GameplayView from '@/components/player/GameplayView';
import type { Story } from '@/types/story';

export default function PlayPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const initSession = usePlayerStore((s) => s.initSession);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
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
          playerObjective: storyData.playerObjective || null,
          entities: (dbStory as any).entities || null,
        };

        // Check for existing session: restore progress + dynamic nodes, or create a DB row.
        let serverSession: any = null;
        try {
          const sessRes = await fetch(`/api/sessions?storyId=${storyId}`);
          if (sessRes.ok) {
            const sessData = await sessRes.json();
            serverSession = sessData.session || null;
            if (serverSession?.dynamicNodes?.length > 0) {
              // Merge dynamic nodes into story
              fullStory.nodes = [...fullStory.nodes, ...serverSession.dynamicNodes];
              if (serverSession.dynamicEdges?.length > 0) {
                fullStory.edges = [...fullStory.edges, ...serverSession.dynamicEdges];
              }
            }
          }
        } catch { /* no session to restore */ }

        if (serverSession?.id && serverSession.currentNodeId) {
          // Mirror server-side achievements / unlocked endings into localStorage (panel source).
          try {
            const a = serverSession.achievements;
            if (a) {
              const akey = `achievements_${storyId}`;
              const localA = JSON.parse(localStorage.getItem(akey) || '{}');
              localStorage.setItem(akey, JSON.stringify({ ...localA, ...a }));
              if (Array.isArray(a.unlockedEndings) && a.unlockedEndings.length) {
                const ukey = `unlockedEndings_${storyId}`;
                const merged = new Set<string>([...(JSON.parse(localStorage.getItem(ukey) || '[]')), ...a.unlockedEndings]);
                localStorage.setItem(ukey, JSON.stringify([...merged]));
              }
            }
          } catch { /* ignore */ }
          usePlayerStore.getState().restoreSession(fullStory, serverSession);
        } else {
          initSession(fullStory);
          // Create the DB session row so history/achievement writes actually persist.
          try {
            const s = usePlayerStore.getState().session;
            if (s) {
              const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storyId, currentNodeId: s.currentNodeId, history: s.history }),
              });
              if (res.ok) {
                const { id } = await res.json();
                if (id) usePlayerStore.getState().setSessionServerId(id);
              }
            }
          } catch { /* offline — localStorage only */ }
        }
      } catch {
        // Network/offline: fall back to a cached copy if we have one for this story,
        // otherwise surface the error. (Never trust the cache while online — we must pick
        // up re-published content + title, which is why we no longer skip the fetch.)
        const cached = usePlayerStore.getState().story;
        if (!cached || cached.id !== storyId) {
          setError('找不到这个影游');
        }
      }
      setLoading(false);
    };

    loadStory();
  }, [storyId]);

  if (loading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-3" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-4xl opacity-30">🎬</div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{error}</p>
      </div>
    );
  }

  return <GameplayView />;
}
