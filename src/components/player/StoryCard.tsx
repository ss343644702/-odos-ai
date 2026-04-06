'use client';

import Link from 'next/link';

interface StoryCardProps {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  authorName: string;
  authorAvatar: string | null;
  playCount: number;
}

export default function StoryCard({
  id,
  title,
  description,
  coverUrl,
  authorName,
  authorAvatar,
  playCount,
}: StoryCardProps) {
  return (
    <Link
      href={`/play/${id}`}
      className="block rounded-xl overflow-hidden transition-transform hover:scale-[1.02] hover:shadow-xl"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Cover image — 1:1 aspect ratio */}
      <div
        className="w-full aspect-square flex items-center justify-center"
        style={{
          background: coverUrl
            ? `url(${coverUrl}) center/cover`
            : `linear-gradient(135deg, var(--accent)20, var(--node-ending)20)`,
        }}
      >
        {!coverUrl && (
          <div className="text-4xl opacity-60">🎬</div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3
          className="text-sm font-medium truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        <p
          className="text-xs mt-1 line-clamp-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {description}
        </p>
        <div
          className="flex items-center justify-between mt-2 text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span className="flex items-center gap-1">
            {authorAvatar ? (
              <img src={authorAvatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
            ) : (
              <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px]" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {authorName.charAt(0)}
              </span>
            )}
            {authorName}
          </span>
          <span>{playCount} 次游玩</span>
        </div>
      </div>
    </Link>
  );
}
