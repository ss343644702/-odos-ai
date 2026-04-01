'use client';

import Link from 'next/link';

interface StoryCardProps {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  nodeCount: number;
  endingCount: number;
  playCount: number;
}

export default function StoryCard({
  id,
  title,
  description,
  coverUrl,
  nodeCount,
  endingCount,
  playCount,
}: StoryCardProps) {
  // Random height for waterfall effect
  const heights = [200, 240, 280, 220, 260];
  const imgHeight = heights[id.charCodeAt(0) % heights.length];

  return (
    <Link
      href={`/play/${id}`}
      className="block rounded-xl overflow-hidden transition-transform hover:scale-[1.02] hover:shadow-xl"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Cover image */}
      <div
        className="w-full flex items-center justify-center"
        style={{
          height: imgHeight,
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
          className="flex items-center gap-3 mt-2 text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>{nodeCount} 个场景</span>
          <span>{endingCount} 个结局</span>
          <span>{playCount} 次游玩</span>
        </div>
      </div>
    </Link>
  );
}
