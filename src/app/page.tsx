import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8" style={{ background: 'var(--bg-primary)' }}>
      <h1 className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
        Odos AI
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>AI 驱动的互动故事，由你书写</p>
      <div className="flex gap-4">
        <Link
          href="/discover"
          className="px-6 py-3 rounded-lg font-medium transition-colors"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          开始体验
        </Link>
        <Link
          href="/editor/new"
          className="px-6 py-3 rounded-lg font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          创作者入口
        </Link>
      </div>
    </div>
  );
}
