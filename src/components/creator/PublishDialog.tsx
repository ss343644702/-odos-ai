'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '@/stores/editorStore';
import { useStoryStore } from '@/stores/storyStore';

export default function PublishDialog() {
  const publishDialogOpen = useEditorStore((s) => s.publishDialogOpen);
  const setPublishDialogOpen = useEditorStore((s) => s.setPublishDialogOpen);
  const story = useStoryStore((s) => s.story);
  const router = useRouter();

  // Derive defaults from story
  const defaultCover = useMemo(() => {
    if (!story) return null;
    for (const node of (story.nodes || [])) {
      if (node.data.imageUrl) return node.data.imageUrl;
      const frame = node.data.frames?.find((f) => f.imageUrl);
      if (frame) return frame.imageUrl;
    }
    return null;
  }, [story]);

  const defaultTags = useMemo(() => {
    if (!story) return [];
    const tagSet = new Set<string>();
    for (const node of (story.nodes || [])) {
      for (const tag of node.data.metadata?.tags || []) {
        if (tag && tag !== 'ai_generated' && tag !== 'fallback' && tag !== 'transition') {
          tagSet.add(tag);
        }
      }
    }
    return [...tagSet].slice(0, 5);
  }, [story]);

  const [title, setTitle] = useState(story?.title || '');
  const [description, setDescription] = useState(story?.description || '');
  const [coverUrl, setCoverUrl] = useState(defaultCover || '');
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [newTag, setNewTag] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  if (!publishDialogOpen || !story) return null;

  const storyNodes = story.nodes || [];
  const nodeCount = storyNodes.filter((n) => n.type !== 'story_config').length;
  const endingCount = storyNodes.filter((n) => n.type === 'ending').length;
  const hasVoice = storyNodes.filter((n) => n.data.voiceSegments?.length > 0).length;
  const hasImage = storyNodes.filter((n) => n.data.imageUrl || n.data.frames?.some((f) => f.imageUrl)).length;
  const hasStart = storyNodes.some((n) => n.type === 'start');

  const issues: string[] = [];
  if (!hasStart) issues.push('缺少开始节点');
  if (endingCount === 0) issues.push('缺少结局节点');
  if (hasImage < nodeCount * 0.3) issues.push(`仅 ${hasImage}/${nodeCount} 个节点有图片`);

  const handlePublish = async () => {
    if (!title.trim()) { setError('请输入影游名称'); return; }
    setPublishing(true);
    setError('');

    try {
      // Save story data first
      const storyData = {
        nodes: story.nodes || [],
        edges: story.edges || [],
        settings: story.settings,
        style: story.style,
        worldView: story.worldView,
      };

      // Create story in DB if it doesn't exist, then publish
      const createRes = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          data: storyData,
          tags,
        }),
      });
      const { id } = await createRes.json();
      if (!id) throw new Error('Failed to create story');

      // Publish
      const pubRes = await fetch(`/api/stories/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          coverImageUrl: coverUrl || null,
          tags,
        }),
      });
      const pubData = await pubRes.json();
      if (!pubData.success) throw new Error('Failed to publish');

      setPublishDialogOpen(false);
      router.push(`/play/${id}`);
    } catch (err: any) {
      setError(err.message || '发布失败，请重试');
      setPublishing(false);
    }
  };

  const addTag = () => {
    const t = newTag.trim();
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t]);
      setNewTag('');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        className="w-[440px] max-h-[85vh] overflow-y-auto rounded-2xl p-6"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>发布影游</h3>
          <button
            onClick={() => setPublishDialogOpen(false)}
            className="p-1 rounded"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cover image */}
        <div className="mb-4">
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>封面图片</label>
          {coverUrl ? (
            <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <img src={coverUrl} alt="封面" className="w-full aspect-video object-cover" />
              <button
                onClick={() => setCoverUrl('')}
                className="absolute top-2 right-2 px-2 py-1 rounded text-[10px]"
                style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}
              >
                更换
              </button>
            </div>
          ) : (
            <div
              className="w-full aspect-video rounded-lg flex items-center justify-center text-xs cursor-pointer"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
              onClick={() => {
                // Use first available image
                if (defaultCover) setCoverUrl(defaultCover);
              }}
            >
              {defaultCover ? '点击使用自动封面' : '暂无封面图片'}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>影游名称</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            placeholder="给你的影游起个名字"
          />
        </div>

        {/* Description */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>一句话介绍</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            placeholder="让玩家一眼了解你的故事"
          />
        </div>

        {/* Tags */}
        <div className="mb-4">
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>标签</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
              >
                {tag}
                <button onClick={() => setTags(tags.filter((t) => t !== tag))} className="opacity-60 hover:opacity-100">
                  ×
                </button>
              </span>
            ))}
          </div>
          {tags.length < 5 && (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                className="flex-1 px-2 py-1.5 rounded text-xs"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                placeholder="添加标签..."
              />
              <button
                onClick={addTag}
                className="px-3 py-1.5 rounded text-xs"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="节点" value={nodeCount} />
          <Stat label="结局" value={endingCount} />
          <Stat label="配音" value={hasVoice} />
          <Stat label="图片" value={hasImage} />
        </div>

        {/* Issues */}
        {issues.length > 0 && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--warning)', color: '#333' }}>
            <div className="text-xs font-medium mb-1">注意事项：</div>
            {issues.map((issue, i) => (
              <div key={i} className="text-xs">• {issue}</div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setPublishDialogOpen(false)}
            className="flex-1 py-2.5 rounded-lg text-sm"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            取消
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {publishing ? '发布中...' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center p-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
      <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}
