'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // Editable fields
  const [nickname, setNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login?next=/settings'); return; }
      setUser(user);

      // Load DB profile for nickname/avatar
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const dbUser = await res.json();
          setNickname(dbUser.nickname || user.user_metadata?.full_name || user.email?.split('@')[0] || '');
          setAvatarUrl(dbUser.avatarUrl || user.user_metadata?.avatar_url || '');
        }
      } catch {
        setNickname(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
        setAvatarUrl(user.user_metadata?.avatar_url || '');
      }
      setLoading(false);
    };
    load();
  }, [router]);

  const saveNickname = async () => {
    if (!nickname.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
    } catch { /* silent */ }
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const { url } = await uploadRes.json();
      if (url) {
        setAvatarUrl(url);
        await fetch('/api/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarUrl: url }),
        });
      }
    } catch { /* silent */ }
    setUploadingAvatar(false);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push('/discover');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <span className="animate-spin mr-2">&#x27F3;</span> 加载中...
      </div>
    );
  }

  const displayName = nickname || user?.email?.split('@')[0] || '用户';

  return (
    <div className="min-h-screen pb-20" style={{ background: 'var(--bg-primary)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10" style={{ background: 'rgba(245,244,237,0.92)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => router.back()} className="p-1" style={{ color: 'var(--text-secondary)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>设置</h1>
      </div>

      {/* Avatar section — clickable to upload */}
      <div className="flex flex-col items-center py-6">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative group"
        >
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
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            {uploadingAvatar ? (
              <span className="text-white text-xs animate-spin">⟳</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </div>
        </button>
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>点击更换头像</p>
      </div>

      {/* Nickname — editable */}
      <div className="px-4 mb-5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-muted)' }}>个人信息</h3>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>昵称</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={saveNickname}
              onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
              className="text-xs text-right bg-transparent outline-none w-40"
              style={{ color: 'var(--text-primary)' }}
              placeholder="输入昵称"
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>邮箱</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.email}</span>
          </div>
        </div>
      </div>

      {/* Read-only sections */}
      <div className="px-4 mb-5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-muted)' }}>关于</h3>
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>版本</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>v0.1.0-alpha</span>
          </div>
        </div>
      </div>

      {/* Logout */}
      <div className="px-4 mt-4">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
          style={{ background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)' }}
        >
          {loggingOut ? '退出中...' : '退出登录'}
        </button>
      </div>
    </div>
  );
}
