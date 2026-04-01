'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';

export default function CreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [sessionLost, setSessionLost] = useState(false);

  useEffect(() => {
    document.body.classList.add('overflow-locked');
    return () => document.body.classList.remove('overflow-locked');
  }, []);

  // Monitor auth state — warn on session expiry instead of silent failures
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        if (event === 'SIGNED_OUT') {
          setSessionLost(true);
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (sessionLost) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <p style={{ color: 'var(--text-secondary)' }}>登录已过期，请重新登录</p>
        <button
          onClick={() => router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)}
          className="px-6 py-2 rounded-lg text-sm"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          重新登录
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
