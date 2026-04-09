'use client';

import { useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStoryStore } from '@/stores/storyStore';
import { useChatStore } from '@/stores/chatStore';
import StoryConfigPanel from './StoryConfigPanel';
import { useEditorStore } from '@/stores/editorStore';
import { v4 as uuid } from 'uuid';
import type { NodeType, Frame } from '@/types/story';
import { getEntityImageList } from '@/lib/entity-utils';

const nodeColors: Record<NodeType, string> = {
  start: 'var(--node-start)',
  scene: 'var(--node-scene)',
  ending: 'var(--node-ending)',
  ai_generated: 'var(--node-ai)',
  story_config: 'var(--accent)',
};

const nodeLabels: Record<NodeType, string> = {
  start: '开始',
  scene: '场景',
  ending: '结局',
  ai_generated: 'AI生成',
  story_config: '故事配置',
};


export default function ParameterPanel() {
  const story = useStoryStore((s) => s.story);
  const updateNode = useStoryStore((s) => s.updateNode);
  const updateFrame = useStoryStore((s) => s.updateFrame);
  const addFrame = useStoryStore((s) => s.addFrame);
  const removeFrame = useStoryStore((s) => s.removeFrame);
  const addChoice = useStoryStore((s) => s.addChoice);
  const updateChoice = useStoryStore((s) => s.updateChoice);
  const removeChoice = useStoryStore((s) => s.removeChoice);
  const removeNode = useStoryStore((s) => s.removeNode);
  const addVoiceSegment = useStoryStore((s) => s.addVoiceSegment);
  const removeVoiceSegment = useStoryStore((s) => s.removeVoiceSegment);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const paramPanelOpen = useEditorStore((s) => s.paramPanelOpen);
  const entities = useChatStore((s) => s.orchestrator.entities);
  const setParamPanelOpen = useEditorStore((s) => s.setParamPanelOpen);
  const selectNode = useEditorStore((s) => s.selectNode);

  const node = story?.nodes?.find((n) => n.id === selectedNodeId);

  const [newChoiceText, setNewChoiceText] = useState('');

  const [generatingFrameId, setGeneratingFrameId] = useState<string | null>(null);
  const [frameProgress, setFrameProgress] = useState('');
  const [activeFrameTab, setActiveFrameTab] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  const [uploadingFrameId, setUploadingFrameId] = useState<string | null>(null);

  // Voice segment editing: track local edits to detect dirty state
  const [segmentEdits, setSegmentEdits] = useState<Record<string, { emotion?: string; speed?: number; text?: string }>>({});
  const [regeneratingSegId, setRegeneratingSegId] = useState<string | null>(null);

  // Reset ALL local state when switching nodes
  useEffect(() => {
    setActiveFrameTab(0);
    setSegmentEdits({});
    setNewChoiceText('');
    setGeneratingFrameId(null);
    setFrameProgress('');
    setIsBatchGenerating(false);
    setBatchProgress('');
    setLightboxImage(null);
  }, [selectedNodeId]);

  const handleClose = useCallback(() => {
    setParamPanelOpen(false);
    selectNode(null);
  }, [setParamPanelOpen, selectNode]);

  const getNodeName = useCallback(
    (nodeId: string) => {
      if (!story || !nodeId) return '未连接';
      const target = (story.nodes || []).find((n) => n.id === nodeId);
      return target?.data.title || '未命名';
    },
    [story]
  );

  // Core: generate image for a single frame (returns promise, no UI state management)
  const generateSingleFrame = useCallback(async (frame: Frame, onProgress?: (msg: string) => void): Promise<void> => {
    if (!node || !frame.imagePrompt) return;

    const entities = useChatStore.getState().orchestrator.entities;
    const imageList = getEntityImageList(entities, frame.entityRefs, node.data.character);
    onProgress?.('提交生成任务...');

    const submitRes = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: frame.imagePrompt,
        aspectRatio: '16:9',
        nodeId: node.id,
        image_list: imageList.length > 0 ? imageList : undefined,
      }),
    });

    const submitData = await submitRes.json();
    if (!submitData.success || !submitData.taskId) {
      throw new Error(submitData.error || '提交失败');
    }

    onProgress?.('图片生成中...');

    let pollDelay = 2000;
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, pollDelay));
      pollDelay = Math.min(pollDelay * 1.3, 5000);
      const pollRes = await fetch(`/api/generate-image?taskId=${submitData.taskId}`);
      const pollData = await pollRes.json();

      if (pollData.status === 'completed' && pollData.imageUrl) {
        updateFrame(node.id, frame.id, { imageUrl: pollData.imageUrl });
        return;
      }
      if (pollData.status === 'failed') throw new Error('图片生成失败');
      onProgress?.(`图片生成中... (${attempt + 1}/15)`);
    }
    throw new Error('图片生成超时');
  }, [node, updateFrame]);

  // Generate image for a single frame (with UI state)
  const handleGenerateFrameImage = useCallback(async (frame: Frame) => {
    if (!node || !frame.imagePrompt || generatingFrameId) return;
    setGeneratingFrameId(frame.id);
    setFrameProgress('');
    try {
      await generateSingleFrame(frame, setFrameProgress);
      setFrameProgress('');
      setGeneratingFrameId(null);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : '未知错误';
      setFrameProgress(errMsg);
      setTimeout(() => { setFrameProgress(''); setGeneratingFrameId(null); }, 3000);
    }
  }, [node, generatingFrameId, generateSingleFrame]);

  // Batch generate all frame images (concurrent, skip existing)
  const handleBatchGenerate = useCallback(async () => {
    if (!node || isBatchGenerating) return;
    const nodeFrames = node.data.frames || [];
    const toGenerate = nodeFrames.filter((f) => f.imagePrompt && !f.imageUrl);
    if (toGenerate.length === 0) return;

    const CONCURRENCY = 3;
    setIsBatchGenerating(true);
    for (let i = 0; i < toGenerate.length; i += CONCURRENCY) {
      const batch = toGenerate.slice(i, i + CONCURRENCY);
      const start = i + 1;
      const end = Math.min(i + CONCURRENCY, toGenerate.length);
      setBatchProgress(`正在生成 ${start}-${end}/${toGenerate.length}...`);
      await Promise.allSettled(batch.map((frame) => generateSingleFrame(frame)));
    }
    setIsBatchGenerating(false);
    setBatchProgress('');
  }, [node, isBatchGenerating, generateSingleFrame]);

  const handleAddFrame = useCallback(() => {
    if (!node) return;
    addFrame(node.id, {
      id: uuid(),
      narrationSegment: '',
      imagePrompt: '',
      imageUrl: null,
      entityRefs: [],
      duration: 3,
    });
  }, [node, addFrame]);

  // Upload local image for a frame
  const handleUploadFrameImage = useCallback(async (frameId: string, file: File) => {
    if (!node) return;
    setUploadingFrameId(frameId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        updateFrame(node.id, frameId, { imageUrl: data.url });
      }
    } catch { /* silent */ }
    setUploadingFrameId(null);
  }, [node, updateFrame]);

  const handleAddChoice = useCallback(() => {
    if (!node || !newChoiceText.trim()) return;
    addChoice(node.id, { id: uuid(), text: newChoiceText.trim(), targetNodeId: '' });
    setNewChoiceText('');
  }, [node, newChoiceText, addChoice]);

  // Helper: map voice segments to frames (same logic as syncFramesFromVoice)
  const getSegmentsForFrame = useCallback((frameIndex: number): { seg: any; globalIndex: number }[] => {
    if (!node?.data.voiceSegments || node.data.voiceSegments.length === 0) return [];
    const segs = node.data.voiceSegments;
    const fLen = (node.data.frames || []).length;
    if (fLen === 0) return [];
    const start = Math.floor(frameIndex * segs.length / fLen);
    const end = Math.floor((frameIndex + 1) * segs.length / fLen);
    return segs.slice(start, end).map((seg, j) => ({ seg, globalIndex: start + j }));
  }, [node]);

  // Helper: regenerate a single voice segment
  const handleRegenSegment = useCallback(async (segId: string, globalIndex: number) => {
    if (!node || regeneratingSegId) return;
    const edits = segmentEdits[segId] || {};
    const seg = node.data.voiceSegments[globalIndex];
    if (!seg) return;
    const currentText = edits.text ?? seg.text;
    const currentEmotion = edits.emotion ?? seg.emotion;
    const currentSpeed = edits.speed ?? seg.speed;

    setRegeneratingSegId(segId);
    try {
      const updated = [...node.data.voiceSegments];
      updated[globalIndex] = { ...updated[globalIndex], text: currentText, emotion: currentEmotion, speed: currentSpeed, audioUrl: null };
      updateNode(node.id, { voiceSegments: updated });

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentText, voiceType: seg.voiceType, speed: currentSpeed, nodeId: node.id }),
      });
      const data = await res.json();
      if (data.success && data.audioUrl) {
        const updated2 = [...node.data.voiceSegments];
        updated2[globalIndex] = { ...updated2[globalIndex], text: currentText, emotion: currentEmotion, speed: currentSpeed, audioUrl: data.audioUrl };
        updateNode(node.id, { voiceSegments: updated2 });
      }
      setSegmentEdits((prev) => { const next = { ...prev }; delete next[segId]; return next; });
    } catch (err) {
      console.error('Voice segment regenerate failed:', err);
    } finally {
      setRegeneratingSegId(null);
    }
  }, [node, regeneratingSegId, segmentEdits, updateNode]);

  if (!paramPanelOpen || !node) return null;

  // Story config node uses its own panel
  if (node.type === 'story_config') return <StoryConfigPanel />;

  const color = nodeColors[node.type] || nodeColors.scene;
  const label = nodeLabels[node.type] || '场景';
  const frames = node.data.frames || [];
  const voiceSegs = node.data.voiceSegments || [];

  // Emotion labels
  const emotionLabels: Record<string, string> = {
    neutral: '中性', happy: '开心', sad: '悲伤', angry: '愤怒', fearful: '恐惧',
    surprised: '惊讶', disgusted: '厌恶', serious: '严肃', gentle: '温柔', excited: '兴奋',
  };
  const emotionKeys = Object.keys(emotionLabels);

  return (
    <div
      className="fixed top-14 right-0 bottom-0 w-80 overflow-y-auto z-40"
      style={{
        background: 'rgba(18, 18, 26, 0.95)',
        borderLeft: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
        animation: 'slideInRight 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        className="sticky top-0 flex items-center justify-between px-4 py-3 z-10"
        style={{ background: 'rgba(18, 18, 26, 0.95)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: `${color}20`, color }}>{label}</span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{node.data.title || '未命名'}</span>
        </div>
        <button onClick={handleClose} className="p-1 rounded transition-colors" style={{ color: 'var(--text-muted)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* ─── Basic Info Section ─── */}
        <SectionBlock title="基本信息">
          <input
            type="text"
            value={node.data.title}
            onChange={(e) => updateNode(node.id, { title: e.target.value })}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            placeholder="节点标题"
          />
          <textarea
            value={node.data.narration}
            onChange={(e) => updateNode(node.id, { narration: e.target.value })}
            rows={3}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs resize-none mt-2"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            placeholder="场景旁白描述..."
          />
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>L{node.data.depth}</span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{node.id.slice(0, 8)}</span>
          </div>
        </SectionBlock>

        {/* ─── Frames + Voice Section ─── */}
        <SectionBlock title={`画面 & 配音 (${frames.length} 帧${voiceSegs.length > 0 ? ` · ${voiceSegs.length} 段` : ''})`}>
          {/* Frame tab strip */}
          {frames.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-2 hide-scrollbar">
              {frames.map((f, i) => {
                const hasVoice = getSegmentsForFrame(i).length > 0;
                return (
                  <button
                    key={f.id}
                    onClick={() => setActiveFrameTab(i)}
                    className="flex-shrink-0 px-2.5 py-1 text-[10px] font-medium rounded-md transition-all"
                    style={{
                      background: i === activeFrameTab ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      color: i === activeFrameTab ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${i === activeFrameTab ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    {i + 1}{f.imageUrl ? ' ✓' : ''}{hasVoice ? ' ♪' : ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* Active frame card */}
          {frames[activeFrameTab] && (() => {
            const frame = frames[activeFrameTab];
            const frameSegs = getSegmentsForFrame(activeFrameTab);

            return (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {/* Image area */}
                {frame.imageUrl ? (
                  <div className="relative">
                    <img
                      src={frame.imageUrl} alt=""
                      className="w-full aspect-video object-cover cursor-pointer"
                      onClick={() => setLightboxImage(frame.imageUrl)}
                    />
                    <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                      <label
                        className="text-[10px] px-2 py-0.5 rounded cursor-pointer"
                        style={{ background: 'rgba(0,0,0,0.7)', color: 'white' }}
                      >
                        {uploadingFrameId === frame.id ? '上传中...' : '上传替换'}
                        <input
                          type="file" accept="image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFrameImage(frame.id, f); e.target.value = ''; }}
                        />
                      </label>
                      <button
                        onClick={() => handleGenerateFrameImage(frame)}
                        disabled={generatingFrameId !== null || isBatchGenerating}
                        className="text-[10px] px-2 py-0.5 rounded"
                        style={{ background: 'rgba(0,0,0,0.7)', color: 'white' }}
                      >
                        {generatingFrameId === frame.id ? '生成中...' : 'AI生成'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="aspect-video flex flex-col items-center justify-center gap-1.5"
                    style={{ background: 'var(--bg-tertiary)' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                    </svg>
                    <div className="flex gap-2">
                      <label
                        className="text-[10px] px-3 py-1 rounded-md cursor-pointer"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {uploadingFrameId === frame.id ? '上传中...' : '上传图片'}
                        <input
                          type="file" accept="image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFrameImage(frame.id, f); e.target.value = ''; }}
                        />
                      </label>
                      <button
                        onClick={() => handleGenerateFrameImage(frame)}
                        disabled={generatingFrameId !== null || isBatchGenerating || !frame.imagePrompt}
                        className="text-[10px] px-3 py-1 rounded-md disabled:opacity-30"
                        style={{ background: 'var(--accent)', color: 'white' }}
                      >
                        {generatingFrameId === frame.id ? (frameProgress || '生成中...') : 'AI生成'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Frame details */}
                <div className="p-2.5 space-y-2" style={{ background: 'var(--bg-secondary)' }}>
                  {/* Narration segment */}
                  <div>
                    <span className="text-[9px] font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>叙述文本</span>
                    <textarea
                      value={frame.narrationSegment}
                      onChange={(e) => updateFrame(node.id, frame.id, { narrationSegment: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1.5 rounded text-[11px] resize-none"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      placeholder="该画面的叙述片段..."
                    />
                  </div>

                  {/* Image prompt (collapsible) */}
                  <details className="group">
                    <summary className="text-[9px] font-medium cursor-pointer select-none flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <span className="group-open:rotate-90 transition-transform inline-block text-[8px]">▶</span>
                      图片提示词
                    </summary>
                    <textarea
                      value={frame.imagePrompt}
                      onChange={(e) => updateFrame(node.id, frame.id, { imagePrompt: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1.5 rounded text-[11px] resize-none mt-1"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      placeholder="英文图片提示词..."
                    />
                  </details>

                  {/* Entity refs for this frame */}
                  <div>
                    <span className="text-[9px] font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>引用主体</span>
                    <div className="flex flex-wrap gap-1">
                      {(frame.entityRefs || []).map((refId: string) => {
                        const allEntities = [
                          ...(entities?.characters || []),
                          ...(entities?.scenes || []),
                          ...(entities?.props || []),
                        ];
                        const entity = allEntities.find((e: any) => e.id === refId);
                        return (
                          <span key={refId} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                            {entity?.name || refId.slice(0, 8)}
                            <button
                              onClick={() => updateFrame(node.id, frame.id, { entityRefs: (frame.entityRefs || []).filter((r: string) => r !== refId) })}
                              className="ml-0.5" style={{ color: 'var(--text-muted)' }}>✕</button>
                          </span>
                        );
                      })}
                      <select
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const current = frame.entityRefs || [];
                          if (!current.includes(e.target.value)) {
                            updateFrame(node.id, frame.id, { entityRefs: [...current, e.target.value] });
                          }
                          e.target.value = '';
                        }}
                        className="text-[10px] px-1 py-0.5 rounded"
                        style={{ background: 'var(--bg-primary)', color: 'var(--accent)', border: '1px dashed var(--border)' }}
                      >
                        <option value="">+ 添加</option>
                        {[...(entities?.characters || []), ...(entities?.scenes || []), ...(entities?.props || [])]
                          .filter((e: any) => !(frame.entityRefs || []).includes(e.id))
                          .map((e: any) => (
                            <option key={e.id} value={e.id}>{e.name}{e.imageUrl ? ' ✓' : ''}</option>
                          ))
                        }
                      </select>
                    </div>
                  </div>

                  {/* Voice segments for this frame */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>
                        配音 ({frameSegs.length} 段)
                      </span>
                      <button
                        onClick={() => addVoiceSegment(node.id, { id: uuid(), text: '', speaker: 'narrator', voiceType: 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null })}
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                      >+ 添加</button>
                    </div>
                    {frameSegs.length > 0 && (
                      <div className="space-y-1.5">
                        {frameSegs.map(({ seg, globalIndex }) => {
                          const segId = seg.id || `seg-${globalIndex}`;
                          const edits = segmentEdits[segId] || {};
                          const curEmotion = edits.emotion ?? seg.emotion;
                          const curSpeed = edits.speed ?? seg.speed;
                          const curText = edits.text ?? seg.text;
                          const isDirty = edits.emotion !== undefined || edits.speed !== undefined || edits.text !== undefined;
                          const isRegen = regeneratingSegId === segId;

                          return (
                            <div
                              key={segId}
                              className="rounded-md p-2"
                              style={{
                                background: 'var(--bg-primary)',
                                border: `1px solid ${isDirty ? 'var(--warning)' : 'var(--border)'}`,
                              }}
                            >
                              {/* Top row: speaker + status + delete */}
                              <div className="flex items-center gap-1.5 mb-1">
                                <select
                                  value={seg.speaker}
                                  onChange={(e) => {
                                    const updated = [...(node.data.voiceSegments || [])];
                                    updated[globalIndex] = { ...updated[globalIndex], speaker: e.target.value };
                                    updateNode(node.id, { voiceSegments: updated });
                                  }}
                                  className="text-[9px] font-medium px-1.5 py-px rounded"
                                  style={{
                                    background: seg.speaker === 'narrator' ? 'var(--bg-tertiary)' : 'var(--accent-dim)',
                                    color: seg.speaker === 'narrator' ? 'var(--text-muted)' : 'var(--accent)',
                                    border: 'none',
                                  }}
                                >
                                  <option value="narrator">旁白</option>
                                  {entities?.characters?.filter((c: any) => c.name !== '旁白').map((c: any) => (
                                    <option key={c.id} value={c.name}>{c.name}</option>
                                  ))}
                                </select>
                                <span className="flex-1" />
                                {isDirty && <span className="text-[9px]" style={{ color: 'var(--warning)' }}>已修改</span>}
                                {seg.audioUrl && !isDirty && <span className="text-[9px]" style={{ color: 'var(--success)' }}>♪</span>}
                                <button
                                  onClick={() => removeVoiceSegment(node.id, globalIndex)}
                                  className="text-[10px] px-1 rounded"
                                  style={{ color: 'var(--danger)' }}
                                  title="删除配音段"
                                >×</button>
                              </div>

                              {/* Emotion + Speed inline */}
                              <div className="flex gap-1.5 mb-1">
                                <select
                                  value={curEmotion}
                                  onChange={(e) => setSegmentEdits((prev) => ({ ...prev, [segId]: { ...prev[segId], emotion: e.target.value } }))}
                                  className="flex-1 px-1 py-0.5 rounded text-[10px]"
                                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                                >
                                  {emotionKeys.map((k) => <option key={k} value={k}>{emotionLabels[k]}</option>)}
                                </select>
                                <div className="flex items-center gap-0.5" style={{ width: 60 }}>
                                  <input
                                    type="number" min={0.5} max={2.0} step={0.1} value={curSpeed}
                                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setSegmentEdits((prev) => ({ ...prev, [segId]: { ...prev[segId], speed: v } })); }}
                                    className="w-full px-1 py-0.5 rounded text-[10px] text-center"
                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                                  />
                                  <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>x</span>
                                </div>
                              </div>

                              {/* Text */}
                              <textarea
                                value={curText}
                                onChange={(e) => setSegmentEdits((prev) => ({ ...prev, [segId]: { ...prev[segId], text: e.target.value } }))}
                                rows={2}
                                className="w-full px-1.5 py-1 rounded text-[11px] resize-none"
                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                              />

                              {/* Regen button */}
                              {isDirty && (
                                <button
                                  onClick={() => handleRegenSegment(segId, globalIndex)}
                                  disabled={isRegen}
                                  className="w-full mt-1 py-1 rounded text-[10px] font-medium"
                                  style={{ background: 'var(--accent)', color: 'white' }}
                                >
                                  {isRegen ? '生成中...' : '重新生成配音'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Frame footer actions */}
                <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                  <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>画面 {activeFrameTab + 1}/{frames.length}</span>
                  <button
                    onClick={() => {
                      removeFrame(node.id, frame.id);
                      if (activeFrameTab >= frames.length - 1) setActiveFrameTab(Math.max(0, frames.length - 2));
                    }}
                    className="text-[10px] px-2 py-0.5 rounded transition-colors"
                    style={{ color: 'var(--danger)' }}
                  >
                    删除帧
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Orphan voice segments (when no frames exist) */}
          {frames.length === 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>配音分段 ({voiceSegs.length})</span>
                <button
                  onClick={() => addVoiceSegment(node.id, { id: uuid(), text: '', speaker: 'narrator', voiceType: 'narrator', emotion: 'neutral', speed: 1.0, audioUrl: null })}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                >+ 添加</button>
              </div>
              {voiceSegs.map((seg, i) => {
                const segId = seg.id || `seg-${i}`;
                const edits = segmentEdits[segId] || {};
                const curText = edits.text ?? seg.text;
                const isDirty = edits.emotion !== undefined || edits.speed !== undefined || edits.text !== undefined;
                return (
                  <div key={segId} className="rounded-md p-2" style={{ background: 'var(--bg-tertiary)', border: `1px solid ${isDirty ? 'var(--warning)' : 'var(--border)'}` }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <select
                        value={seg.speaker}
                        onChange={(e) => {
                          const updated = [...(node.data.voiceSegments || [])];
                          updated[i] = { ...updated[i], speaker: e.target.value };
                          updateNode(node.id, { voiceSegments: updated });
                        }}
                        className="text-[9px] font-medium px-1.5 py-px rounded"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: 'none' }}
                      >
                        <option value="narrator">旁白</option>
                        {entities?.characters?.filter((c: any) => c.name !== '旁白').map((c: any) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <span className="flex-1" />
                      {seg.audioUrl && !isDirty && <span className="text-[9px]" style={{ color: 'var(--success)' }}>♪</span>}
                      {isDirty && <span className="text-[9px]" style={{ color: 'var(--warning)' }}>已修改</span>}
                      <button
                        onClick={() => removeVoiceSegment(node.id, i)}
                        className="text-[10px] px-1 rounded"
                        style={{ color: 'var(--danger)' }}
                      >×</button>
                    </div>
                    <textarea
                      value={curText}
                      onChange={(e) => setSegmentEdits((prev) => ({ ...prev, [segId]: { ...prev[segId], text: e.target.value } }))}
                      rows={2}
                      className="w-full px-1.5 py-1 rounded text-[11px] resize-none"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    />
                    {isDirty && (
                      <button
                        onClick={() => handleRegenSegment(segId, i)}
                        disabled={regeneratingSegId === segId}
                        className="w-full mt-1 py-1 rounded text-[10px] font-medium"
                        style={{ background: 'var(--accent)', color: 'white' }}
                      >
                        {regeneratingSegId === segId ? '生成中...' : '重新生成配音'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom actions */}
          <div className="flex gap-2 mt-2">
            {frames.length > 0 && (
              <button
                onClick={handleBatchGenerate}
                disabled={isBatchGenerating || generatingFrameId !== null || frames.every((f) => !f.imagePrompt)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-40"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
              >
                {isBatchGenerating ? batchProgress : '一键生成图片'}
              </button>
            )}
            <button
              onClick={handleAddFrame}
              className="px-3 py-1.5 rounded-lg text-[11px] transition-colors"
              style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}
            >
              + 添加帧
            </button>
          </div>
        </SectionBlock>

        {/* ─── Choices Section ─── */}
        {node.type !== 'ending' && (
          <SectionBlock title={`分支选项 (${(node.data.choices || []).length})`}>
            <div className="space-y-1.5">
              {(node.data.choices || []).map((choice, i) => (
                <div key={choice.id} className="flex items-center gap-1.5 rounded-lg p-1.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                  <span className="text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded" style={{ background: `${color}20`, color, flexShrink: 0 }}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={choice.text}
                      onChange={(e) => updateChoice(node.id, choice.id, { text: e.target.value })}
                      className="w-full px-2 py-1 rounded text-[11px]"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      placeholder="选项文字"
                    />
                    {choice.targetNodeId && (
                      <span className="text-[9px] px-2 block mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        → {getNodeName(choice.targetNodeId)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const next = choice.visibility === 'hidden' ? 'visible' : 'hidden';
                      updateChoice(node.id, choice.id, { visibility: next });
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      background: choice.visibility === 'hidden' ? 'rgba(255,170,0,0.15)' : 'var(--bg-primary)',
                      color: choice.visibility === 'hidden' ? '#ffa500' : 'var(--text-muted)',
                    }}
                    title={choice.visibility === 'hidden' ? '隐藏选项：游玩时不可见，需自由输入触发' : '可见选项：点击切换为隐藏'}
                  >
                    {choice.visibility === 'hidden' ? '🔒' : '👁'}
                  </button>
                  <button onClick={() => removeChoice(node.id, choice.id)} className="p-0.5 rounded flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newChoiceText}
                  onChange={(e) => setNewChoiceText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChoice()}
                  className="flex-1 px-2 py-1.5 rounded text-[11px]"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px dashed var(--border)' }}
                  placeholder="添加选项..."
                />
                <button onClick={handleAddChoice} disabled={!newChoiceText.trim()} className="p-1 rounded disabled:opacity-30" style={{ color: 'var(--accent)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>

              {/* Allow Custom Input toggle — moved inside choices section */}
              <div
                className="flex items-center justify-between pt-2 mt-1"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>允许自由输入</label>
                <button
                  onClick={() => updateNode(node.id, { allowCustomInput: !node.data.allowCustomInput })}
                  className="relative rounded-full transition-colors"
                  style={{
                    width: 36,
                    height: 20,
                    background: node.data.allowCustomInput ? 'var(--accent)' : 'var(--bg-tertiary)',
                    border: `1px solid ${node.data.allowCustomInput ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <span
                    className="absolute rounded-full transition-all"
                    style={{
                      width: 14,
                      height: 14,
                      top: 2,
                      left: node.data.allowCustomInput ? 18 : 2,
                      background: 'white',
                    }}
                  />
                </button>
              </div>
            </div>
          </SectionBlock>
        )}

        {/* ─── Danger Zone (not for story-config) ─── */}
        {node.id !== 'story-config' && (
          <button
            onClick={() => { removeNode(node.id); handleClose(); }}
            className="w-full py-2 rounded-lg text-[11px] transition-colors"
            style={{ color: 'var(--danger)', border: '1px solid var(--danger)', background: 'transparent', opacity: 0.7 }}
          >
            删除节点
          </button>
        )}
      </div>

      {/* Lightbox for frame images */}
      {lightboxImage && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-5 right-5 p-2.5 rounded-full transition-colors hover:bg-white/20"
            style={{ color: 'white' }}
            onClick={() => setLightboxImage(null)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={lightboxImage}
            alt=""
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl"
            style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            点击空白处关闭
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-3 py-2" style={{ background: 'var(--bg-tertiary)' }}>
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</span>
      </div>
      <div className="p-2.5" style={{ background: 'var(--bg-secondary)' }}>
        {children}
      </div>
    </div>
  );
}
