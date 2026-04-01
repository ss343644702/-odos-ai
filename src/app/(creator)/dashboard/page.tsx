'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';

interface StoryItem {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  tags: string[];
  playCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState('');
  const router = useRouter();
  const supabase = getSupabaseBrowser();

  useEffect(() => {
    const load = async () => {
      // Get user info
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setNickname(user.user_metadata?.nickname || user.email?.split('@')[0] || '创作者');
      }

      // Fetch user's stories
      try {
        const res = await fetch('/api/me/stories');
        const data = await res.json();
        setStories(data.stories || []);
      } catch {
        setStories([]);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen p-8" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              我的影游
            </h1>
            {nickname && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {nickname}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href="/discover"
              className="px-4 py-2 rounded-lg text-sm"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              发现影游
            </Link>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              退出登录
            </button>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
            加载中...
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {/* New story card */}
            <Link
              href="/editor/new"
              className="rounded-xl p-6 transition-colors hover:border-[var(--accent)] flex flex-col items-center justify-center"
              style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)', minHeight: 200 }}
            >
              <div className="text-3xl mb-2" style={{ color: 'var(--accent)' }}>+</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>新建影游</div>
            </Link>

            {/* Existing stories */}
            {stories.map((s) => (
              <Link
                key={s.id}
                href={`/editor/${s.id}`}
                className="rounded-xl overflow-hidden transition-colors hover:border-[var(--accent)]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 200 }}
              >
                {/* Cover */}
                <div
                  className="w-full h-24 flex items-center justify-center"
                  style={{
                    background: s.coverImageUrl
                      ? `url(${s.coverImageUrl}) center/cover`
                      : 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
                  }}
                >
                  {!s.coverImageUrl && <div className="text-2xl opacity-20">🎬</div>}
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {s.title}
                    </h3>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        background: s.status === 'PUBLISHED' ? 'var(--success)' : 'var(--bg-tertiary)',
                        color: s.status === 'PUBLISHED' ? 'white' : 'var(--text-muted)',
                      }}
                    >
                      {s.status === 'PUBLISHED' ? '已发布' : '草稿'}
                    </span>
                  </div>

                  {s.description && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {s.description}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {s.status === 'PUBLISHED' && <span>{s.playCount} 次游玩</span>}
                    <span>更新于 {new Date(s.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
