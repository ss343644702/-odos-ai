'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';
import { Suspense } from 'react';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowser();

  const nextUrl = searchParams.get('redirect') || searchParams.get('next') || '/discover';

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');

    if (isRegister) {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) {
        setLoading(false);
        setError(signUpError.message);
        return;
      }
      // Registration successful — show email verification prompt
      setLoading(false);
      setEmailSent(true);
      setCountdown(120);
      return;
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setLoading(false);
        setError(signInError.message);
        return;
      }
    }

    router.push(nextUrl);
  };

  const handleResend = useCallback(async () => {
    if (countdown > 0) return;
    setLoading(true);
    setError('');
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    setLoading(false);
    if (resendError) {
      setError(resendError.message);
    } else {
      setCountdown(120);
    }
  }, [countdown, email, supabase.auth]);

  const handleGithub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}` },
    });
  };

  // Email verification sent — show confirmation screen
  if (emailSent) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-[360px] text-center">
          {/* Mail icon */}
          <div className="mb-6">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            验证邮件已发送
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            我们已向 <span style={{ color: 'var(--text-primary)' }}>{email}</span> 发送了一封验证邮件，请查收并点击链接完成注册
          </p>

          {error && (
            <p className="text-xs mb-4" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <button
            onClick={handleResend}
            disabled={countdown > 0 || loading}
            className="w-full py-3 rounded-xl text-sm font-medium disabled:opacity-40 transition-all mb-3"
            style={{
              background: countdown > 0 ? 'var(--bg-tertiary)' : 'var(--accent)',
              color: countdown > 0 ? 'var(--text-muted)' : 'white',
              border: countdown > 0 ? '1px solid var(--border)' : 'none',
            }}
          >
            {loading ? '发送中...' : countdown > 0 ? `重新发送 (${countdown}s)` : '重新发送验证邮件'}
          </button>

          <button
            onClick={() => { setEmailSent(false); setIsRegister(false); setError(''); setPassword(''); }}
            className="text-xs"
            style={{ color: 'var(--accent)' }}
          >
            返回登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="w-full max-w-[360px]">
        {/* Branding */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Odos AI
          </h1>
          <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? '创建账号，开始你的互动故事' : '登录后探索和创作互动故事'}
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱地址"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors focus:ring-1"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              '--tw-ring-color': 'var(--accent)',
            } as React.CSSProperties}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="密码"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors focus:ring-1"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              '--tw-ring-color': 'var(--accent)',
            } as React.CSSProperties}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !email.trim() || !password}
            className="w-full py-3 rounded-xl text-sm font-medium disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </div>

        {error && (
          <p className="text-xs mt-3 text-center" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="text-xs"
            style={{ color: 'var(--accent)' }}
          >
            {isRegister ? '已有账号？登录' : '没有账号？注册'}
          </button>
        </div>


        {/* Back link */}
        <div className="mt-8 text-center">
          <button
            onClick={() => router.back()}
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            返回
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        加载中...
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
