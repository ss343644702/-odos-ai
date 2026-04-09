'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowser } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface StoryItem {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  status: string;
  playCount: number;
  updatedAt: string;
}

type Tab = 'works' | 'likes' | 'favorites';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('works');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [dbProfile, setDbProfile] = useState<{ nickname?: string; avatarUrl?: string } | null>(null);

  const published = stories.filter((s) => s.status === 'PUBLISHED');
  const drafts = stories.filter((s) => s.status === 'DRAFT');

  const loadStories = useCallback(async () => {
    try {
      const res = await fetch('/api/me/stories');
      if (res.ok) {
        const data = await res.json();
        setStories(data.stories || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        await loadStories();
        // Load DB profile (nickname, avatarUrl) which may differ from Supabase metadata
        try {
          const meRes = await fetch('/api/me');
          if (meRes.ok) setDbProfile(await meRes.json());
        } catch { /* ignore */ }
      }
      setLoading(false);
    };
    load();
  }, [loadStories]);

  const handleDelete = async (storyId: string) => {
    if (!confirm('确定删除这个作品吗？')) return;
    setDeletingId(storyId);
    setShowMenu(null);
    try {
      const res = await fetch(`/api/stories/${storyId}`, { method: 'DELETE' });
      if (res.ok) {
        setStories((prev) => prev.filter((s) => s.id !== storyId));
      }
    } catch {
      // ignore
    }
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <span className="animate-spin mr-2">&#x27F3;</span> 加载中...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 pb-20">
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>登录后查看你的作品和账号信息</p>
        <Link
          href="/login?next=/profile"
          className="px-8 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          登录 / 注册
        </Link>
      </div>
    );
  }

  const displayName = dbProfile?.nickname || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '用户';
  const avatarUrl = dbProfile?.avatarUrl || user.user_metadata?.avatar_url;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'works',
      label: '作品',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      key: 'likes',
      label: '喜欢',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      ),
    },
    {
      key: 'favorites',
      label: '收藏',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--bg-primary)' }} onClick={() => setShowMenu(null)}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Odos</span>
        <Link href="/settings" className="p-2" style={{ color: 'var(--text-secondary)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>

      {/* Profile header */}
      <div className="px-5 pt-4 pb-5">
        <div className="flex items-start justify-between">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold"
              style={{ background: 'linear-gradient(135deg, var(--accent), #e879f9)', color: 'white' }}
            >
              {displayName[0].toUpperCase()}
            </div>
          )}
          <button
            onClick={() => router.push('/settings')}
            className="px-4 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            编辑资料
          </button>
        </div>

        <h2 className="text-xl font-bold mt-3" style={{ color: 'var(--text-primary)' }}>
          {displayName}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          @{user.email?.split('@')[0]}
        </p>

        {/* Stats */}
        <div className="flex gap-5 mt-4">
          <div>
            <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{published.length}</span>
            <span className="text-[11px] ml-1" style={{ color: 'var(--text-muted)' }}>作品</span>
          </div>
          <div>
            <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {stories.reduce((sum, s) => sum + (s.playCount || 0), 0)}
            </span>
            <span className="text-[11px] ml-1" style={{ color: 'var(--text-muted)' }}>游玩</span>
          </div>
          <div>
            <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{drafts.length}</span>
            <span className="text-[11px] ml-1" style={{ color: 'var(--text-muted)' }}>草稿</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors relative"
            style={{ color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ background: 'var(--text-primary)' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-1 pt-1">
        {activeTab === 'works' && (
          <div className="grid grid-cols-3 gap-0.5">
            {/* Drafts box - first card */}
            <Link
              href="/profile/drafts"
              className="aspect-square flex flex-col items-center justify-center gap-2 transition-colors"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                草稿箱 ({drafts.length})
              </span>
            </Link>

            {/* Published works */}
            {published.map((story) => (
              <div key={story.id} className="aspect-square relative group">
                <Link href={`/play/${story.id}`} className="block w-full h-full">
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{
                      background: story.coverImageUrl
                        ? `url(${story.coverImageUrl}) center/cover`
                        : 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
                    }}
                  >
                    {!story.coverImageUrl && (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                        <rect x="2" y="2" width="20" height="20" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                      </svg>
                    )}
                  </div>
                </Link>
                {/* Overlay info on hover/tap */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                  <p className="text-[10px] text-white truncate">{story.title}</p>
                  <p className="text-[9px] text-white/60">{story.playCount || 0} 次游玩</p>
                </div>
                {/* Menu button */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowMenu(showMenu === story.id ? null : story.id);
                  }}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.6)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                {/* Dropdown menu */}
                {showMenu === story.id && (
                  <div
                    className="absolute top-8 right-1 z-20 rounded-lg py-1 min-w-[100px] shadow-xl"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => { setShowMenu(null); router.push(`/editor/${story.id}`); }}
                      className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:opacity-80"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(story.id)}
                      disabled={deletingId === story.id}
                      className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:opacity-80"
                      style={{ color: 'var(--danger)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      {deletingId === story.id ? '删除中...' : '删除'}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Empty state if no published works */}
            {published.length === 0 && (
              <Link
                href="/editor/new"
                className="aspect-square flex flex-col items-center justify-center gap-2"
                style={{ background: 'var(--bg-secondary)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-[11px]" style={{ color: 'var(--accent)' }}>创作</span>
              </Link>
            )}
          </div>
        )}

        {activeTab === 'likes' && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>你喜欢的作品会出现在这里</p>
            <Link href="/discover" className="text-xs mt-1" style={{ color: 'var(--accent)' }}>去探索</Link>
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>你收藏的作品会出现在这里</p>
            <Link href="/discover" className="text-xs mt-1" style={{ color: 'var(--accent)' }}>去探索</Link>
          </div>
        )}
      </div>
    </div>
  );
}
