'use client';

import { useState, useEffect } from 'react';
import WaterfallGrid from '@/components/player/WaterfallGrid';
import Link from 'next/link';

const TAGS = ['全部', '悬疑', '职场', '科幻', '古风', '校园', '末日', '冒险'];

export default function DiscoverPage() {
  const [stories, setStories] = useState<any[]>([]);
  const [activeTag, setActiveTag] = useState('全部');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStories = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeTag !== '全部') params.set('tag', activeTag);
        const res = await fetch(`/api/stories?${params}`);
        const data = await res.json();
        setStories(
          (data.stories || []).map((s: any) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            coverUrl: s.coverImageUrl || null,
            authorName: s.author?.nickname || '匿名创作者',
            authorAvatar: s.author?.avatarUrl || null,
            playCount: s.playCount || 0,
          })),
        );
      } catch {
        setStories([]);
      }
      setLoading(false);
    };
    fetchStories();
  }, [activeTag]);

  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(245,244,237,0.9)', backdropFilter: 'blur(12px)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Odos AI
        </h1>
        <Link
          href="/editor/new"
          className="text-xs px-3 py-1.5 rounded-full"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          + 创作
        </Link>
      </div>

      {/* Category tags */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto hide-scrollbar">
        {TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveTag(tag)}
            className="px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors"
            style={{
              background: tag === activeTag ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: tag === activeTag ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${tag === activeTag ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
          <span className="animate-spin mr-2">⟳</span> 加载中...
        </div>
      ) : stories.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3 opacity-30">🎬</div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            还没有发布的影游，快去创作第一个吧！
          </p>
          <Link
            href="/editor/new"
            className="inline-block mt-4 px-6 py-2 rounded-lg text-sm"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            开始创作
          </Link>
        </div>
      ) : (
        <WaterfallGrid stories={stories} />
      )}
    </div>
  );
}
