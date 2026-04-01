'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase';

interface DraftItem {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  updatedAt: string;
}

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login?next=/profile/drafts'); return; }

      try {
        const res = await fetch('/api/me/stories');
        if (res.ok) {
          const data = await res.json();
          setDrafts((data.stories || []).filter((s: any) => s.status === 'DRAFT'));
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这个草稿吗？')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/stories/${id}`, { method: 'DELETE' });
      if (res.ok) setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch { /* ignore */ }
    setDeletingId(null);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen pb-20" style={{ background: 'var(--bg-primary)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10" style={{ background: 'rgba(12,12,16,0.95)', backdropFilter: 'blur(12px)' }}>
        <button onClick={() => router.back()} className="p-1" style={{ color: 'var(--text-secondary)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>草稿箱</h1>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({drafts.length})</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
          <span className="animate-spin mr-2">&#x27F3;</span> 加载中...
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无草稿</p>
        </div>
      ) : (
        <div className="px-4 space-y-3 mt-2">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="flex gap-3 rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              <div
                className="w-24 h-24 flex-shrink-0 flex items-center justify-center cursor-pointer"
                onClick={() => router.push(`/editor/${draft.id}`)}
                style={{
                  background: draft.coverImageUrl
                    ? `url(${draft.coverImageUrl}) center/cover`
                    : 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-hover))',
                }}
              >
                {!draft.coverImageUrl && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
              </div>
              <div className="flex-1 py-2.5 pr-2 flex flex-col justify-between">
                <div>
                  <h3
                    className="text-sm font-medium truncate cursor-pointer"
                    style={{ color: 'var(--text-primary)' }}
                    onClick={() => router.push(`/editor/${draft.id}`)}
                  >
                    {draft.title || '无标题'}
                  </h3>
                  <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                    {draft.description || '暂无描述'}
                  </p>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(draft.updatedAt)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/editor/${draft.id}`)}
                      className="text-[11px] px-2.5 py-1 rounded-md"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(draft.id)}
                      disabled={deletingId === draft.id}
                      className="text-[11px] px-2.5 py-1 rounded-md"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--danger)' }}
                    >
                      {deletingId === draft.id ? '...' : '删除'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
