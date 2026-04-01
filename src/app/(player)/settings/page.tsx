'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login?next=/settings'); return; }
      setUser(user);
      setLoading(false);
    };
    load();
  }, [router]);

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

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || '用户';
  const avatarUrl = user?.user_metadata?.avatar_url;

  const sections: { title: string; items: { label: string; value: string; action?: boolean }[] }[] = [
    {
      title: '账号',
      items: [
        { label: '用户名', value: displayName },
        { label: '邮箱', value: user?.email || '' },
        { label: '登录方式', value: user?.app_metadata?.provider === 'github' ? 'GitHub' : '邮箱密码' },
      ],
    },
    {
      title: '通用',
      items: [
        { label: '语言', value: '中文' },
        { label: '深色模式', value: '开启' },
      ],
    },
    {
      title: '关于',
      items: [
        { label: '版本', value: 'v0.1.0-alpha' },
        { label: '服务条款', value: '', action: true },
        { label: '隐私政策', value: '', action: true },
      ],
    },
  ];

  return (
    <div className="min-h-screen pb-20" style={{ background: 'var(--bg-primary)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10" style={{ background: 'rgba(12,12,16,0.95)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => router.back()} className="p-1" style={{ color: 'var(--text-secondary)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>设置</h1>
      </div>

      {/* Avatar section */}
      <div className="flex flex-col items-center py-6">
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
        <p className="text-sm font-medium mt-3" style={{ color: 'var(--text-primary)' }}>{displayName}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
      </div>

      {/* Settings sections */}
      {sections.map((section) => (
        <div key={section.title} className="px-4 mb-5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-muted)' }}>
            {section.title}
          </h3>
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            {section.items.map((item, i) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}
              >
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.value}</span>
                  {item.action && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

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
