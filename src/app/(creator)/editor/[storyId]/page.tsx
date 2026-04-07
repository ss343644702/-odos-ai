'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import TopBar from '@/components/creator/TopBar';
import AgentChat from '@/components/creator/AgentChat';
import ParameterPanel from '@/components/creator/ParameterPanel';
import PreviewModal from '@/components/creator/PreviewModal';
import PublishDialog from '@/components/creator/PublishDialog';
import { useStoryStore } from '@/stores/storyStore';
import { useChatStore } from '@/stores/chatStore';
import type { Story } from '@/types/story';

const StoryCanvas = dynamic(() => import('@/components/creator/StoryCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
      加载画布...
    </div>
  ),
});

export default function EditorPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const router = useRouter();
  const story = useStoryStore((s) => s.story);
  const initStory = useStoryStore((s) => s.initStory);
  const setStory = useStoryStore((s) => s.setStory);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dbStoryId = useRef<string | null>(null);

  // Wait for zustand persist rehydration (both stores)
  useEffect(() => {
    let storyReady = useStoryStore.persist.hasHydrated();
    let chatReady = useChatStore.persist.hasHydrated();
    const check = () => { if (storyReady && chatReady) setHydrated(true); };

    const unsub1 = useStoryStore.persist.onFinishHydration(() => { storyReady = true; check(); });
    const unsub2 = useChatStore.persist.onFinishHydration(() => { chatReady = true; check(); });
    check();
    return () => { unsub1(); unsub2(); };
  }, []);

  // Load or create story
  useEffect(() => {
    if (!hydrated) return;

    const init = async () => {
      if (storyId === 'new') {
        // Always create a fresh empty story for /editor/new
        initStory('新影游', '');
        useChatStore.getState().clearMessages();
        try {
          const storyState = useStoryStore.getState().story;
          const res = await fetch('/api/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: storyState?.title || '新影游',
              data: storyState ? {
                nodes: storyState.nodes,
                edges: storyState.edges,
                settings: storyState.settings,
                style: storyState.style,
                worldView: storyState.worldView,
              } : {},
            }),
          });
          const { id } = await res.json();
          if (id) {
            dbStoryId.current = id;
            // Update URL without triggering a Next.js navigation/remount
            window.history.replaceState(null, '', `/editor/${id}`);
          }
        } catch {
          // Offline fallback — continue with localStorage
        }
        setLoading(false);
        return;
      }

      // Load existing story from DB
      try {
        const res = await fetch(`/api/stories/${storyId}`);
        if (res.ok) {
          const dbStory = await res.json();
          const data = dbStory.data as any;
          const fullStory: Story = {
            id: dbStory.id,
            title: dbStory.title,
            description: dbStory.description,
            coverImageUrl: dbStory.coverImageUrl,
            authorId: dbStory.authorId,
            status: dbStory.status.toLowerCase() as 'draft' | 'published',
            createdAt: dbStory.createdAt,
            updatedAt: dbStory.updatedAt,
            nodes: data.nodes || [],
            edges: data.edges || [],
            settings: data.settings || { defaultVoice: 'narrator', imageStyle: '', language: 'zh-CN', maxDepth: 5, endingCount: 3 },
            worldView: data.worldView || '',
            style: data.style || { styleId: '', styleName: '', stylePromptPrefix: '', colorTone: '', lightingStyle: '' },
          };
          dbStoryId.current = dbStory.id;
          setStory(fullStory);
        } else {
          // Not found in DB — use localStorage if available
          if (!useStoryStore.getState().story) {
            initStory('新影游', '');
          }
        }
      } catch {
        // Offline — use localStorage
        if (!useStoryStore.getState().story) {
          initStory('新影游', '');
        }
      }
      setLoading(false);
    };

    init();
  }, [hydrated, storyId]);

  // Auto-save to DB (debounced 3s)
  useEffect(() => {
    if (!hydrated) return;

    const unsub = useStoryStore.subscribe((state) => {
      if (!state.story) return;
      const id = dbStoryId.current || storyId;
      if (!id || id === 'new') return;

      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        const s = useStoryStore.getState().story;
        if (!s) return;
        try {
          await fetch(`/api/stories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: s.title,
              description: s.description,
              data: {
                nodes: s.nodes,
                edges: s.edges,
                settings: s.settings,
                style: s.style,
                worldView: s.worldView,
              },
              entities: s.entities || undefined,
            }),
          });
        } catch {
          // Silent fail — will retry on next change
        }
      }, 3000);
    });

    return () => {
      unsub();
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [hydrated, storyId]);

  if (!hydrated || loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        加载中...
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <TopBar />
      <div className="absolute inset-0 pt-14">
        <StoryCanvas />
      </div>
      <AgentChat />
      <ParameterPanel />
      <PreviewModal />
      <PublishDialog />
    </div>
  );
}
