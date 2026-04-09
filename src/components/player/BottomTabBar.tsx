'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BottomTabBar() {
  const pathname = usePathname();

  // Hide on full-screen pages
  if (pathname.startsWith('/play')) return null;
  if (pathname.startsWith('/profile/drafts')) return null;
  if (pathname.startsWith('/settings')) return null;

  const isDiscover = pathname === '/discover' || pathname.startsWith('/discover/');
  const isProfile = pathname === '/profile' || pathname.startsWith('/profile/');

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] h-16 flex items-center justify-around z-50"
      style={{
        background: 'rgba(245, 244, 237, 0.9)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* Explore tab */}
      <Link href="/discover" className="flex flex-col items-center gap-0.5 py-1 px-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.8"
          stroke={isDiscover ? 'var(--accent)' : 'var(--text-secondary)'}
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={isDiscover ? 'var(--accent)' : 'none'} />
          <polyline points="9 22 9 12 15 12 15 22" stroke={isDiscover ? 'white' : 'var(--text-secondary)'} />
        </svg>
        <span className="text-[10px]" style={{ color: isDiscover ? 'var(--accent)' : 'var(--text-secondary)' }}>
          首页
        </span>
      </Link>

      {/* Profile tab */}
      <Link href="/profile" className="flex flex-col items-center gap-0.5 py-1 px-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.8"
          stroke={isProfile ? 'var(--accent)' : 'var(--text-secondary)'}
        >
          <circle cx="12" cy="8" r="4" fill={isProfile ? 'var(--accent)' : 'none'} />
          <path d="M20 21a8 8 0 1 0-16 0" />
        </svg>
        <span className="text-[10px]" style={{ color: isProfile ? 'var(--accent)' : 'var(--text-secondary)' }}>
          我的
        </span>
      </Link>
    </nav>
  );
}
