'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useStoryStore } from '@/stores/storyStore';
import { useEditorStore } from '@/stores/editorStore';

export default function TopBar() {
  const story = useStoryStore((s) => s.story);
  const updateTitle = useStoryStore((s) => s.updateTitle);
  const toggleAgentPanel = useEditorStore((s) => s.toggleAgentPanel);
  const agentPanelOpen = useEditorStore((s) => s.agentPanelOpen);
  const setPreviewOpen = useEditorStore((s) => s.setPreviewOpen);
  const setPublishDialogOpen = useEditorStore((s) => s.setPublishDialogOpen);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const nodeCount = story?.nodes?.length || 0;
  const edgeCount = story?.edges?.length || 0;

  const handleStartEdit = () => {
    setEditValue(story?.title || '');
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== story?.title) {
      updateTitle(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setIsEditing(false);
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 z-50"
      style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(18, 18, 26, 0.9)',
      }}
    >
      {/* Left: Home + Agent toggle + title */}
      <div className="flex items-center gap-3">
        <Link
          href="/discover"
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title="返回首页"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>

        <button
          onClick={toggleAgentPanel}
          className="p-2 rounded-lg transition-colors"
          style={{
            background: agentPanelOpen ? 'var(--accent-dim)' : 'transparent',
            color: agentPanelOpen ? 'var(--accent)' : 'var(--text-secondary)',
          }}
          title="Agent 面板"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        <div className="h-6 w-px" style={{ background: 'var(--border)' }} />

        <div>
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="text-sm font-medium bg-transparent outline-none px-1 -ml-1 rounded"
              style={{
                color: 'var(--text-primary)',
                border: '1px solid var(--accent)',
                width: Math.max(120, editValue.length * 14),
                maxWidth: 240,
              }}
            />
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-1.5 group text-left"
              title="点击修改项目名称"
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {story?.title || '未命名项目'}
              </span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="var(--text-muted)" strokeWidth="2"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {nodeCount} 节点 · {edgeCount} 连线
          </div>
        </div>
      </div>

      {/* Right: Preview + Publish */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPreviewOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          预览
        </button>
        <button
          onClick={() => setPublishDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          发布
        </button>
      </div>
    </div>
  );
}
