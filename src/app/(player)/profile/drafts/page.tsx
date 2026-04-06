'use client';

import { useState, useEffect, useCallback } from 'react';
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

  // Batch mode state
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

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

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === drafts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(drafts.map((d) => d.id)));
    }
  }, [selected.size, drafts]);

  const handleBatchDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 个草稿吗？`)) return;
    setBatchDeleting(true);
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map((id) => fetch(`/api/stories/${id}`, { method: 'DELETE' }))
    );
    setDrafts((prev) => prev.filter((d) => !selected.has(d.id)));
    setSelected(new Set());
    setBatchMode(false);
    setBatchDeleting(false);
  }, [selected]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, []);

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
        <h1 className="text-base font-bold flex-1" style={{ color: 'var(--text-primary)' }}>
          草稿箱<span className="font-normal" style={{ color: 'var(--text-muted)' }}>({drafts.length})</span>
        </h1>

        {/* Batch mode toggle */}
        {drafts.length > 0 && !loading && (
          batchMode ? (
            <button
              onClick={exitBatchMode}
              className="text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--accent)' }}
            >
              取消
            </button>
          ) : (
            <button
              onClick={() => setBatchMode(true)}
              className="text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--text-secondary)' }}
            >
              管理
            </button>
          )
        )}
      </div>

      {/* Batch action bar */}
      {batchMode && (
        <div
          className="flex items-center justify-between px-4 py-2 sticky top-[52px] z-10"
          style={{ background: 'rgba(12,12,16,0.95)', borderBottom: '1px solid var(--border)' }}
        >
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span
              className="w-4 h-4 rounded border flex items-center justify-center"
              style={{
                borderColor: selected.size === drafts.length ? 'var(--accent)' : 'var(--border)',
                background: selected.size === drafts.length ? 'var(--accent)' : 'transparent',
              }}
            >
              {selected.size === drafts.length && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            全选
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              已选 {selected.size} 项
            </span>
            <button
              onClick={handleBatchDelete}
              disabled={selected.size === 0 || batchDeleting}
              className="text-xs px-3 py-1.5 rounded-md font-medium"
              style={{
                background: selected.size > 0 ? 'var(--danger)' : 'var(--bg-tertiary)',
                color: selected.size > 0 ? 'white' : 'var(--text-muted)',
                opacity: batchDeleting ? 0.6 : 1,
              }}
            >
              {batchDeleting ? '删除中...' : '删除'}
            </button>
          </div>
        </div>
      )}

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
              style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${batchMode && selected.has(draft.id) ? 'var(--accent)' : 'var(--border)'}`,
              }}
              onClick={batchMode ? () => toggleSelect(draft.id) : undefined}
            >
              {/* Batch checkbox */}
              {batchMode && (
                <div className="flex items-center pl-3">
                  <span
                    className="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: selected.has(draft.id) ? 'var(--accent)' : 'var(--border)',
                      background: selected.has(draft.id) ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    {selected.has(draft.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                </div>
              )}

              <div
                className={`w-24 h-24 flex-shrink-0 flex items-center justify-center ${!batchMode ? 'cursor-pointer' : ''}`}
                onClick={!batchMode ? () => router.push(`/editor/${draft.id}?from=drafts`) : undefined}
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
                    className={`text-sm font-medium truncate ${!batchMode ? 'cursor-pointer' : ''}`}
                    style={{ color: 'var(--text-primary)' }}
                    onClick={!batchMode ? () => router.push(`/editor/${draft.id}?from=drafts`) : undefined}
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
                  {!batchMode && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push(`/editor/${draft.id}?from=drafts`)}
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
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
