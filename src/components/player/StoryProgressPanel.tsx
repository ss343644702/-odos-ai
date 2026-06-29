'use client';

import { useMemo } from 'react';
import { usePlayerStore } from '@/stores/playerStore';

/** Visual metadata per ending type — medal color + label + glyph. */
export const ENDING_META: Record<string, { label: string; color: string; glyph: string }> = {
  best: { label: 'Best', color: '#22c55e', glyph: '★' },
  good: { label: 'Good', color: '#3b82f6', glyph: '✦' },
  normal: { label: 'Normal', color: '#a78bfa', glyph: '◆' },
  bad: { label: 'Bad', color: '#ef4444', glyph: '☓' },
  hidden: { label: 'Hidden', color: '#f59e0b', glyph: '✧' },
};
const ENDING_ORDER = ['best', 'good', 'normal', 'bad', 'hidden'];

/** Ending node ids the player has reached (persisted across replays + synced from server). */
export function getUnlockedEndingIds(storyId: string): Set<string> {
  const ids = new Set<string>();
  try {
    const raw = localStorage.getItem(`unlockedEndings_${storyId}`);
    if (raw) (JSON.parse(raw) as string[]).forEach((id) => ids.add(id));
  } catch { /* ignore */ }
  try {
    const a = JSON.parse(localStorage.getItem(`achievements_${storyId}`) || '{}');
    if (Array.isArray(a.unlockedEndings)) (a.unlockedEndings as string[]).forEach((id) => ids.add(id));
  } catch { /* ignore */ }
  return ids;
}

export default function StoryProgressPanel({ onClose }: { onClose: () => void }) {
  const story = usePlayerStore((s) => s.story);
  const session = usePlayerStore((s) => s.session);
  const currentNode = usePlayerStore((s) => s.currentNode);

  // Progress = visited official nodes / all official nodes.
  // "Official" = authored story nodes: excludes the story_config meta-node and any
  // ai_generated node (including free-input custom endings, which are type 'ending' but
  // tagged 'ai_generated'). Keeps the denominator stable across free-input playthroughs.
  const isOfficial = (n: any) =>
    n.type !== 'story_config' && !(n.data?.metadata?.tags?.includes('ai_generated'));

  const { pct, visitedCount, total } = useMemo(() => {
    const authored = (story?.nodes || []).filter(isOfficial);
    const visited = new Set<string>();
    (session?.history || []).forEach((h: any) => { if (h.nodeId) visited.add(h.nodeId); });
    if (currentNode?.id) visited.add(currentNode.id);
    const visitedCount = authored.filter((n) => visited.has(n.id)).length;
    const total = authored.length;
    return { total, visitedCount, pct: total ? Math.round((visitedCount / total) * 100) : 0 };
  }, [story, session, currentNode]);

  // Group ending NODES by title+type so duplicate endings (e.g. two sublines that both end
  // at the same outcome) collapse into a single medal instead of showing twice.
  const endings = useMemo(() => {
    const list = (story?.nodes || []).filter((n) => n.type === 'ending' && isOfficial(n));
    const groups = new Map<string, { ids: string[]; title: string; type: string }>();
    for (const n of list) {
      const type = n.data.metadata?.endingType || 'normal';
      const key = `${(n.data.title || '').trim()}|${type}`;
      const g = groups.get(key);
      if (g) g.ids.push(n.id);
      else groups.set(key, { ids: [n.id], title: n.data.title, type });
    }
    return [...groups.values()].sort((a, b) =>
      ENDING_ORDER.indexOf(a.type) - ENDING_ORDER.indexOf(b.type),
    );
  }, [story]);

  if (!story) return null;

  const unlocked = getUnlockedEndingIds(story.id);
  // Reflect the just-reached ending immediately, even before localStorage round-trips.
  if (currentNode?.type === 'ending') unlocked.add(currentNode.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center fade-in"
      style={{ background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl overflow-y-auto hide-scrollbar"
        style={{
          background: 'var(--bg-primary)',
          maxHeight: '85vh',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
          border: '1px solid var(--border-strong)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-5 py-3.5 z-10"
          style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>故事进度</span>
          <button
            onClick={onClose}
            className="p-1 rounded-full transition-transform active:scale-90"
            style={{ color: 'var(--text-muted)' }}
            title="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* World view */}
          <section>
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>世界观</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
              {story.worldView?.trim() || '（暂无世界观设定）'}
            </p>
          </section>

          {/* Progress */}
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>故事进度</h3>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {visitedCount} / {total} 节点 · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{pct}%</span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--accent)' }}
              />
            </div>
          </section>

          {/* Endings — medals */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>故事结局</h3>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                已解锁 {endings.filter((e) => e.ids.some((id) => unlocked.has(id))).length} / {endings.length}
              </span>
            </div>

            {endings.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>（这个故事还没有结局节点）</p>
            ) : (
              <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                {endings.map((e) => {
                  const meta = ENDING_META[e.type] || ENDING_META.normal;
                  const isUnlocked = e.ids.some((id) => unlocked.has(id));
                  return (
                    <div key={e.ids[0]} className="flex flex-col items-center text-center gap-1.5">
                      {/* Medal */}
                      <div
                        className="flex items-center justify-center rounded-full"
                        style={{
                          width: 56,
                          height: 56,
                          background: isUnlocked
                            ? `radial-gradient(circle at 35% 30%, ${meta.color}, ${meta.color}cc)`
                            : 'var(--bg-tertiary)',
                          border: `2px solid ${isUnlocked ? meta.color : 'var(--border-strong)'}`,
                          boxShadow: isUnlocked ? `0 2px 10px ${meta.color}55` : 'none',
                          color: isUnlocked ? '#fff' : 'var(--text-muted)',
                        }}
                      >
                        {isUnlocked ? (
                          <span style={{ fontSize: 22, lineHeight: 1 }}>{meta.glyph}</span>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        )}
                      </div>
                      {/* Type label */}
                      <span
                        className="text-[10px] font-bold tracking-wide"
                        style={{ color: isUnlocked ? meta.color : 'var(--text-muted)' }}
                      >
                        {meta.label}
                      </span>
                      {/* Ending name — only revealed after unlock */}
                      <span
                        className="text-[11px] leading-tight"
                        style={{ color: isUnlocked ? 'var(--text-secondary)' : 'var(--text-muted)' }}
                      >
                        {isUnlocked ? e.title : '？？？'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
