'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuid } from 'uuid';
import { useChatStore } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { useStoryStore } from '@/stores/storyStore';
import type { VoiceType } from '@/types/story';
import { PRESET_STYLES } from '@/lib/agent/types';

const voiceTypeLabels: Record<VoiceType, string> = {
  narrator: '旁白（中性沉稳）',
  young_male: '少年/青年男性',
  mature_male: '成熟男性',
  young_female: '少女/青年女性',
  mature_female: '成熟女性',
  elder: '长者',
  child: '孩童',
};

const voiceDescriptions: Record<VoiceType, string> = {
  narrator: '新闻主播风格，中性沉稳',
  young_male: '温柔少年，清澈干净',
  mature_male: '可靠高管，沉稳有力',
  young_female: '温暖女孩，甜美亲切',
  mature_female: '成熟女性，优雅知性',
  elder: '幽默长者，慈祥温和',
  child: '可爱精灵，活泼天真',
};

const VOICE_OPTIONS: VoiceType[] = ['narrator', 'young_male', 'mature_male', 'young_female', 'mature_female', 'elder', 'child'];

// Collapsible section
function Section({ title, icon, defaultOpen = false, children }: {
  title: string; icon: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium"
        style={{ color: 'var(--text-primary)' }}
      >
        <span>{icon}</span>
        <span className="flex-1">{title}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : '' }}>▼</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// Readonly field
function ReadonlyField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="mb-2">
      <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{value}</p>
    </div>
  );
}

export default function StoryConfigPanel() {
  const paramPanelOpen = useEditorStore((s) => s.paramPanelOpen);
  const orchestrator = useChatStore((s) => s.orchestrator);
  const updateEntityField = useChatStore((s) => s.updateEntityField);
  const updateEntityImage = useChatStore((s) => s.updateEntityImage);
  const addEntity = useChatStore((s) => s.addEntity);
  const removeEntity = useChatStore((s) => s.removeEntity);
  const updateOutlineField = useChatStore((s) => s.updateOutlineField);
  const addOutlineCharacter = useChatStore((s) => s.addOutlineCharacter);
  const removeOutlineCharacter = useChatStore((s) => s.removeOutlineCharacter);
  const updateOutlineCharacter = useChatStore((s) => s.updateOutlineCharacter);
  const addOutlineEnding = useChatStore((s) => s.addOutlineEnding);
  const removeOutlineEnding = useChatStore((s) => s.removeOutlineEnding);
  const updateOutlineEnding = useChatStore((s) => s.updateOutlineEnding);
  const addOutlinePlotPoint = useChatStore((s) => s.addOutlinePlotPoint);
  const removeOutlinePlotPoint = useChatStore((s) => s.removeOutlinePlotPoint);
  const updateOutlinePlotPoint = useChatStore((s) => s.updateOutlinePlotPoint);
  const story = useStoryStore((s) => s.story);
  const updateNode = useStoryStore((s) => s.updateNode);
  const updateSettings = useStoryStore((s) => s.updateSettings);

  const [entityTab, setEntityTab] = useState<'characters' | 'scenes' | 'props'>('characters');
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityDesc, setNewEntityDesc] = useState('');

  // Lightbox state for entity images
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Voice preview state
  const [previewingVoice, setPreviewingVoice] = useState<VoiceType | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [regeneratingVoiceChar, setRegeneratingVoiceChar] = useState<string | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { previewAudio?.pause(); };
  }, [previewAudio]);

  // Preview a voice type with sample text
  const handlePreviewVoice = useCallback(async (voiceType: VoiceType) => {
    // Stop current preview
    if (previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
    if (previewingVoice === voiceType) {
      setPreviewingVoice(null);
      setPreviewAudio(null);
      return;
    }
    setPreviewingVoice(voiceType);
    try {
      const sampleText = '你好，这是一段语音试听示例。欢迎来到互动故事的世界。';
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleText, voiceType, speed: 1.0, nodeId: 'preview' }),
      });
      const data = await res.json();
      if (data.success && data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.onended = () => { setPreviewingVoice(null); setPreviewAudio(null); };
        audio.play();
        setPreviewAudio(audio);
      } else {
        setPreviewingVoice(null);
      }
    } catch {
      setPreviewingVoice(null);
    }
  }, [previewAudio, previewingVoice]);

  // Regenerate all audio for a character after voice change
  const handleRegenCharVoice = useCallback(async (charId: string, charName: string, newVoiceType: VoiceType) => {
    if (!story) return;
    setRegeneratingVoiceChar(charId);
    try {
      // Find all nodes with voiceSegments that reference this character
      for (const node of (story.nodes || [])) {
        if (!node.data.voiceSegments || node.data.voiceSegments.length === 0) continue;
        const updated = [...node.data.voiceSegments];
        let changed = false;
        for (let i = 0; i < updated.length; i++) {
          const seg = updated[i];
          const isMatch = seg.speaker === charName || (charName === '旁白' && seg.speaker === 'narrator');
          if (!isMatch) continue;
          // Regenerate this segment
          try {
            const res = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: seg.text, voiceType: newVoiceType, speed: seg.speed, nodeId: node.id }),
            });
            const data = await res.json();
            if (data.success && data.audioUrl) {
              updated[i] = { ...seg, voiceType: newVoiceType, audioUrl: data.audioUrl };
              changed = true;
            }
          } catch { /* skip failed segments */ }
        }
        if (changed) {
          updateNode(node.id, { voiceSegments: updated });
        }
      }
    } finally {
      setRegeneratingVoiceChar(null);
    }
  }, [story, updateNode]);

  const style = orchestrator.style;
  const outline = orchestrator.outline;
  const entities = orchestrator.entities;

  // Regenerate single entity image
  const handleRegenImage = useCallback(async (type: 'characters' | 'scenes' | 'props', id: string, prompt: string, aspectRatio: string) => {
    if (!prompt.trim()) return;
    setGeneratingIds((prev) => new Set(prev).add(id));
    try {
      const stylePrefix = style?.stylePromptPrefix || '';
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `${stylePrefix}${prompt}`, aspectRatio }),
      });
      const data = await res.json();
      if (!data.success || !data.taskId) return;

      let pollDelay = 2000;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        pollDelay = Math.min(pollDelay * 1.3, 5000);
        const poll = await fetch(`/api/generate-image?taskId=${data.taskId}`);
        const pollData = await poll.json();
        if (pollData.status === 'completed' && pollData.imageUrl) {
          updateEntityImage(type, id, pollData.imageUrl);
          break;
        }
        if (pollData.status === 'failed') break;
      }
    } finally {
      setGeneratingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [style, updateEntityImage]);

  if (!paramPanelOpen) return null;

  const entityTabLabels = { characters: '角色', scenes: '场景', props: '道具' };
  const entityListRaw = entities ? entities[entityTab] || [] : [];
  // Filter out narrator from character list — narrator is managed separately in voice config
  const entityList = entityTab === 'characters'
    ? entityListRaw.filter((e: any) => e.name !== '旁白' && e.role !== 'narrator')
    : entityListRaw;

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
        className="sticky top-0 flex items-center justify-between p-4 z-10"
        style={{ background: 'rgba(18, 18, 26, 0.95)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            故事配置
          </span>
        </div>
        <button
          onClick={() => useEditorStore.getState().selectNode(null)}
          className="p-1 rounded"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 0. Basic Info — editable */}
      <Section title="基本信息" icon="📝" defaultOpen={true}>
        <div className="px-4 pb-3 space-y-2">
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>描述</span>
            <textarea
              value={story?.description || ''}
              onChange={(e) => { if (story) useStoryStore.getState().setStory({ ...story, description: e.target.value, updatedAt: new Date().toISOString() }); }}
              rows={2}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs resize-none mt-1"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder="故事简介..."
            />
          </div>
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>世界观</span>
            <textarea
              value={story?.worldView || ''}
              onChange={(e) => { if (story) useStoryStore.getState().setWorldView(e.target.value); }}
              rows={3}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs resize-none mt-1"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder="世界观设定..."
            />
          </div>
        </div>
      </Section>

      {/* 0.5 Player Objective — editable */}
      <Section title="玩家目标" icon="🎯">
        <div className="px-4 pb-3 space-y-2">
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>主要目标</span>
            <input
              value={story?.playerObjective?.primary || ''}
              onChange={(e) => {
                const obj = story?.playerObjective || { primary: '', hidden: '', measurement: '' };
                useStoryStore.getState().setPlayerObjective({ ...obj, primary: e.target.value });
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs mt-1"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder="玩家从一开始就知道的目标"
            />
          </div>
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>隐藏真相</span>
            <input
              value={story?.playerObjective?.hidden || ''}
              onChange={(e) => {
                const obj = story?.playerObjective || { primary: '', hidden: '', measurement: '' };
                useStoryStore.getState().setPlayerObjective({ ...obj, hidden: e.target.value });
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs mt-1"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder="玩家不知道的深层真相"
            />
          </div>
          <div>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>衡量维度</span>
            <input
              value={story?.playerObjective?.measurement || ''}
              onChange={(e) => {
                const obj = story?.playerObjective || { primary: '', hidden: '', measurement: '' };
                useStoryStore.getState().setPlayerObjective({ ...obj, measurement: e.target.value });
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs mt-1"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              placeholder="目标达成的衡量维度"
            />
          </div>
        </div>
      </Section>

      {/* 0.8 Settings — editable */}
      <Section title="故事设置" icon="⚙️">
        <div className="px-4 pb-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>最大深度</span>
            <input
              type="number"
              value={story?.settings?.maxDepth || 10}
              onChange={(e) => updateSettings({ maxDepth: parseInt(e.target.value) || 10 })}
              min={3} max={15}
              className="w-16 px-2 py-1 rounded text-xs text-right"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>结局数量</span>
            <input
              type="number"
              value={story?.settings?.endingCount || 3}
              onChange={(e) => updateSettings({ endingCount: parseInt(e.target.value) || 3 })}
              min={1} max={8}
              className="w-16 px-2 py-1 rounded text-xs text-right"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>
        </div>
      </Section>

      {/* 1. Style — with selector */}
      <Section title="画面风格" icon="🎨" defaultOpen={true}>
        <div className="px-4 pb-3">
          <select
            value={style?.styleId || ''}
            onChange={(e) => {
              const selected = PRESET_STYLES.find(s => s.styleId === e.target.value);
              if (selected) useStoryStore.getState().setStyle(selected);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs mb-2"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <option value="">选择风格...</option>
            {PRESET_STYLES.map(s => (
              <option key={s.styleId} value={s.styleId}>{s.styleName}</option>
            ))}
          </select>
          {style && (
            <>
              <ReadonlyField label="色调" value={style.colorTone} />
              <ReadonlyField label="光影" value={style.lightingStyle} />
              <p className="text-[10px] leading-relaxed break-all" style={{ color: 'var(--text-muted)' }}>
                {style.stylePromptPrefix}
              </p>
            </>
          )}
        </div>
      </Section>

      {/* 2. Outline (editable) */}
      <Section title="剧本大纲" icon="📋">
        {outline ? (
          <div className="space-y-3">
            {/* Theme + Tone */}
            <div>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>主题</span>
              <input
                value={outline.theme}
                onChange={(e) => updateOutlineField('theme', e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs mt-0.5"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>基调</span>
              <input
                value={outline.tone}
                onChange={(e) => updateOutlineField('tone', e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs mt-0.5"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>层数</span>
              <input
                type="number"
                value={outline.depth}
                onChange={(e) => updateOutlineField('depth', parseInt(e.target.value) || 3)}
                min={2} max={10}
                className="w-16 px-2 py-1 rounded text-xs text-right"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
            </div>

            {/* Characters */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>角色</span>
                <button
                  onClick={() => addOutlineCharacter({ name: '', role: '', description: '', gender: 'other' })}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                >+ 添加</button>
              </div>
              <div className="space-y-2">
                {outline.characters.map((c, i) => (
                  <div key={i} className="p-2 rounded-lg space-y-1.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                    <div className="flex gap-1.5">
                      <input
                        value={c.name}
                        onChange={(e) => updateOutlineCharacter(i, 'name', e.target.value)}
                        placeholder="名字"
                        className="flex-1 px-2 py-1 rounded text-[11px]"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                      <input
                        value={c.role}
                        onChange={(e) => updateOutlineCharacter(i, 'role', e.target.value)}
                        placeholder="角色定位"
                        className="flex-1 px-2 py-1 rounded text-[11px]"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                      <button
                        onClick={() => { if (confirm(`删除角色「${c.name || '未命名'}」？`)) removeOutlineCharacter(i); }}
                        className="px-1.5 rounded text-[11px]"
                        style={{ color: '#ef4444' }}
                        title="删除"
                      >×</button>
                    </div>
                    <textarea
                      value={c.description}
                      onChange={(e) => updateOutlineCharacter(i, 'description', e.target.value)}
                      placeholder="角色描述..."
                      rows={1}
                      className="w-full px-2 py-1 rounded text-[11px] resize-none"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Plot Points */}
            {(outline.plotPoints || []).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>情节点</span>
                  <button
                    onClick={() => addOutlinePlotPoint({ id: uuid(), title: '', description: '' })}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                  >+ 添加</button>
                </div>
                <div className="space-y-2">
                  {(outline.plotPoints || []).map((p, i) => (
                    <div key={p.id || i} className="p-2 rounded-lg space-y-1.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[10px] font-mono w-5 text-center flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                        <input
                          value={p.title}
                          onChange={(e) => updateOutlinePlotPoint(i, 'title', e.target.value)}
                          placeholder="标题"
                          className="flex-1 px-2 py-1 rounded text-[11px]"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                        />
                        <button
                          onClick={() => { if (confirm(`删除情节点「${p.title || '未命名'}」？`)) removeOutlinePlotPoint(i); }}
                          className="px-1.5 rounded text-[11px]"
                          style={{ color: '#ef4444' }}
                        >×</button>
                      </div>
                      <textarea
                        value={p.description}
                        onChange={(e) => updateOutlinePlotPoint(i, 'description', e.target.value)}
                        placeholder="描述..."
                        rows={2}
                        className="w-full px-2 py-1 rounded text-[11px] resize-none"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(outline.plotPoints || []).length === 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>暂无情节点</span>
                <button
                  onClick={() => addOutlinePlotPoint({ id: uuid(), title: '', description: '' })}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                >+ 添加</button>
              </div>
            )}

            {/* Endings */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>结局</span>
                <button
                  onClick={() => addOutlineEnding({ id: uuid(), title: '', type: 'normal', description: '' })}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}
                >+ 添加</button>
              </div>
              <div className="space-y-2">
                {(outline.endings || []).map((e, i) => {
                  const typeColors: Record<string, string> = { best: '#22c55e', good: '#3b82f6', normal: '#a78bfa', bad: '#ef4444', hidden: '#f59e0b' };
                  return (
                    <div key={e.id || i} className="p-2 rounded-lg space-y-1.5" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                      <div className="flex gap-1.5 items-center">
                        <select
                          value={e.type}
                          onChange={(ev) => updateOutlineEnding(i, 'type', ev.target.value)}
                          className="text-[10px] px-1.5 py-1 rounded"
                          style={{ background: `${typeColors[e.type] || '#888'}20`, color: typeColors[e.type] || '#888', border: 'none', fontWeight: 600 }}
                        >
                          <option value="best">best</option>
                          <option value="good">good</option>
                          <option value="normal">normal</option>
                          <option value="bad">bad</option>
                          <option value="hidden">hidden</option>
                        </select>
                        <input
                          value={e.title}
                          onChange={(ev) => updateOutlineEnding(i, 'title', ev.target.value)}
                          placeholder="结局标题"
                          className="flex-1 px-2 py-1 rounded text-[11px]"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                        />
                        <button
                          onClick={() => { if (confirm(`删除结局「${e.title || '未命名'}」？`)) removeOutlineEnding(i); }}
                          className="px-1.5 rounded text-[11px]"
                          style={{ color: '#ef4444' }}
                        >×</button>
                      </div>
                      <textarea
                        value={e.description}
                        onChange={(ev) => updateOutlineEnding(i, 'description', ev.target.value)}
                        placeholder="结局描述..."
                        rows={2}
                        className="w-full px-2 py-1 rounded text-[11px] resize-none"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>尚未生成大纲</p>
            <button
              onClick={() => useChatStore.getState().setOutline({
                theme: '', worldView: '', tone: '', depth: 5,
                characters: [], plotPoints: [], endings: [],
              })}
              className="text-xs px-4 py-1.5 rounded-lg"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              手动创建大纲
            </button>
          </div>
        )}
      </Section>

      {/* 3. Entities (editable) */}
      <Section title="主体管理" icon="👤" defaultOpen={true}>
        {entities ? (
          <>
            {/* Tab bar + add button */}
            <div className="flex gap-1 mb-3">
              {(['characters', 'scenes', 'props'] as const).map((tab) => {
                const count = entities[tab]?.length || 0;
                return (
                  <button
                    key={tab}
                    onClick={() => { setEntityTab(tab); setAddingEntity(false); }}
                    className="flex-1 text-xs py-1.5 rounded-lg transition-colors"
                    style={{
                      background: entityTab === tab ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      color: entityTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: entityTab === tab ? 600 : 400,
                    }}
                  >
                    {entityTabLabels[tab]} ({count})
                  </button>
                );
              })}
              <button
                onClick={() => { setAddingEntity(!addingEntity); setNewEntityName(''); setNewEntityDesc(''); }}
                className="w-8 text-sm rounded-lg flex items-center justify-center"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
                title={`添加${entityTabLabels[entityTab]}`}
              >+</button>
            </div>

            {/* Inline add form */}
            {addingEntity && (
              <div className="mb-3 p-2.5 rounded-lg space-y-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--accent-dim)' }}>
                <input
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder="名称"
                  className="w-full px-2 py-1.5 rounded text-xs"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  autoFocus
                />
                <textarea
                  value={newEntityDesc}
                  onChange={(e) => setNewEntityDesc(e.target.value)}
                  placeholder="描述"
                  rows={2}
                  className="w-full px-2 py-1.5 rounded text-xs resize-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (!newEntityName.trim()) return;
                      const base = { id: uuid(), name: newEntityName.trim(), description: newEntityDesc.trim(), imagePrompt: '', imageUrl: null };
                      let entity: any;
                      if (entityTab === 'characters') {
                        entity = { ...base, appearance: '', personality: '', gender: 'other' as const, ageRange: '', voiceType: 'narrator' as const };
                      } else if (entityTab === 'scenes') {
                        entity = { ...base, mood: '', lighting: '' };
                      } else {
                        entity = { ...base, significance: '' };
                      }
                      addEntity(entityTab, entity);
                      setAddingEntity(false);
                      setNewEntityName('');
                      setNewEntityDesc('');
                    }}
                    disabled={!newEntityName.trim()}
                    className="flex-1 text-xs py-1.5 rounded-lg"
                    style={{ background: 'var(--accent)', color: 'white', opacity: newEntityName.trim() ? 1 : 0.4 }}
                  >
                    添加
                  </button>
                  <button
                    onClick={() => setAddingEntity(false)}
                    className="px-3 text-xs py-1.5 rounded-lg"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* Entity cards */}
            <div className="space-y-2">
              {entityList.map((entity: any) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  type={entityTab}
                  isGenerating={generatingIds.has(entity.id)}
                  onUpdateField={(field, value) => updateEntityField(entityTab, entity.id, field, value)}
                  onRegenImage={() => {
                    const ar = entityTab === 'characters' ? '3:4' : entityTab === 'scenes' ? '16:9' : '1:1';
                    handleRegenImage(entityTab, entity.id, entity.imagePrompt, ar);
                  }}
                  onImageClick={(url) => setLightboxImage(url)}
                  onRemove={() => {
                    if (confirm(`确定删除「${entity.name}」吗？`)) {
                      removeEntity(entityTab, entity.id);
                    }
                  }}
                />
              ))}
              {entityList.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>暂无{entityTabLabels[entityTab]}数据</p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>尚未提取主体</p>
            <button
              onClick={() => useChatStore.getState().setEntities({ characters: [], scenes: [], props: [] })}
              className="text-xs px-4 py-1.5 rounded-lg"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              手动创建主体
            </button>
          </div>
        )}
      </Section>

      {/* 4. Voice config (editable) */}
      <Section title="音色配置" icon="🎙️">
        {entities?.characters ? (
          <div className="space-y-2">
            {/* Voice palette — preview all voices */}
            <div className="mb-3">
              <span className="text-[10px] font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>可用音色（点击试听）</span>
              <div className="grid grid-cols-2 gap-1">
                {VOICE_OPTIONS.map((vt) => (
                  <button
                    key={vt}
                    onClick={() => handlePreviewVoice(vt)}
                    disabled={previewingVoice !== null && previewingVoice !== vt}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all"
                    style={{
                      background: previewingVoice === vt ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      border: `1px solid ${previewingVoice === vt ? 'var(--accent)' : 'var(--border)'}`,
                      opacity: previewingVoice !== null && previewingVoice !== vt ? 0.5 : 1,
                    }}
                  >
                    <span className="text-[10px]" style={{ color: previewingVoice === vt ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {previewingVoice === vt ? '■' : '▶'}
                    </span>
                    <div className="min-w-0">
                      <span className="text-[10px] font-medium block truncate" style={{ color: 'var(--text-primary)' }}>
                        {voiceTypeLabels[vt].split('（')[0]}
                      </span>
                      <span className="text-[9px] block truncate" style={{ color: 'var(--text-muted)' }}>
                        {voiceDescriptions[vt].slice(0, 10)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Narrator row (voice selectable) */}
            <div className="py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xs flex-1 font-medium" style={{ color: 'var(--text-primary)' }}>旁白</span>
                <select
                  value={story?.settings?.defaultVoice || 'narrator'}
                  onChange={(e) => {
                    updateSettings({ defaultVoice: e.target.value });
                  }}
                  className="text-[11px] px-2 py-1 rounded-lg"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                    maxWidth: 130,
                  }}
                >
                  {VOICE_OPTIONS.map((vt) => (
                    <option key={vt} value={vt}>{voiceTypeLabels[vt]}</option>
                  ))}
                </select>
              </div>
              {story?.settings?.defaultVoice && story.settings.defaultVoice !== 'narrator' && (
                <button
                  onClick={() => handleRegenCharVoice('narrator', '旁白', (story.settings.defaultVoice || 'narrator') as VoiceType)}
                  disabled={regeneratingVoiceChar === 'narrator'}
                  className="mt-1.5 w-full text-[10px] py-1 rounded transition-colors"
                  style={{
                    background: regeneratingVoiceChar === 'narrator' ? 'var(--bg-secondary)' : 'var(--accent-dim)',
                    color: regeneratingVoiceChar === 'narrator' ? 'var(--text-muted)' : 'var(--accent)',
                  }}
                >
                  {regeneratingVoiceChar === 'narrator' ? '重新生成中...' : '更换音色后重新生成配音'}
                </button>
              )}
            </div>

            {/* Character rows (exclude narrator) */}
            {entities.characters.filter((char: any) => char.name !== '旁白' && char.role !== 'narrator').map((char: any) => {
              const isRegenerating = regeneratingVoiceChar === char.id;
              return (
                <div key={char.id} className="py-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block" style={{ color: 'var(--text-primary)' }}>{char.name}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{char.gender === 'male' ? '男' : char.gender === 'female' ? '女' : '其他'}</span>
                    </div>
                    <select
                      value={char.voiceType || 'narrator'}
                      onChange={(e) => updateEntityField('characters', char.id, 'voiceType', e.target.value)}
                      className="text-[11px] px-2 py-1 rounded-lg"
                      style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        maxWidth: 130,
                      }}
                    >
                      {VOICE_OPTIONS.map((vt) => (
                        <option key={vt} value={vt}>{voiceTypeLabels[vt]}</option>
                      ))}
                    </select>
                  </div>
                  {/* Regenerate button */}
                  <button
                    onClick={() => handleRegenCharVoice(char.id, char.name, char.voiceType || 'narrator')}
                    disabled={isRegenerating}
                    className="mt-1.5 w-full text-[10px] py-1 rounded transition-colors"
                    style={{
                      background: isRegenerating ? 'var(--bg-secondary)' : 'var(--accent-dim)',
                      color: isRegenerating ? 'var(--text-muted)' : 'var(--accent)',
                    }}
                  >
                    {isRegenerating ? '重新生成中...' : '更换音色后重新生成配音'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>尚未提取角色数据</p>
        )}
      </Section>

      {/* Image Lightbox */}
      {lightboxImage && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightboxImage(null)}
        >
          {/* Close button */}
          <button
            className="absolute top-5 right-5 p-2.5 rounded-full transition-colors hover:bg-white/20"
            style={{ color: 'white' }}
            onClick={() => setLightboxImage(null)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* Image */}
          <img
            src={lightboxImage}
            alt=""
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl"
            style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* Hint */}
          <p className="absolute bottom-5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            点击空白处关闭
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}

// --- Entity Card Component ---
function EntityCard({ entity, type, isGenerating, onUpdateField, onRegenImage, onImageClick, onRemove }: {
  entity: any;
  type: string;
  isGenerating: boolean;
  onUpdateField: (field: string, value: any) => void;
  onRegenImage: () => void;
  onImageClick?: (url: string) => void;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
      {/* Card header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 p-2 text-left"
      >
        {/* Thumbnail — clickable to enlarge */}
        <div
          className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center relative cursor-pointer group"
          style={{
            background: entity.imageUrl
              ? `url(${entity.imageUrl}) center/cover`
              : 'var(--bg-secondary)',
          }}
          onClick={(e) => {
            if (entity.imageUrl && onImageClick) {
              e.stopPropagation();
              onImageClick(entity.imageUrl);
            }
          }}
        >
          {!entity.imageUrl && (
            <span className="text-sm opacity-40">
              {type === 'characters' ? '👤' : type === 'scenes' ? '🏞️' : '🎭'}
            </span>
          )}
          {entity.imageUrl && (
            <div className="absolute inset-0 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.4)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </div>
          )}
          {isGenerating && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <span className="animate-spin text-xs">⟳</span>
            </div>
          )}
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{entity.name}</p>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {entity.description}
          </p>
        </div>

        <span className="text-[10px]" style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}>▼</span>
      </button>

      {/* Expanded edit area */}
      {expanded && (
        <div className="px-2 pb-2 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          {/* Editable name */}
          <div className="mt-2">
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>名称</span>
            <input
              value={entity.name || ''}
              onChange={(e) => onUpdateField('name', e.target.value)}
              className="w-full mt-1 px-2 py-1.5 rounded text-[11px]"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>
          {/* Editable description */}
          <div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>描述</span>
            <textarea
              value={entity.description || ''}
              onChange={(e) => onUpdateField('description', e.target.value)}
              rows={2}
              className="w-full mt-1 px-2 py-1.5 rounded text-[11px] resize-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>
          {/* Image prompt */}
          <div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>图片提示词</span>
            <textarea
              value={entity.imagePrompt || ''}
              onChange={(e) => onUpdateField('imagePrompt', e.target.value)}
              rows={2}
              className="w-full mt-1 px-2 py-1.5 rounded text-[11px] resize-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>

          {/* Regen button */}
          <button
            onClick={onRegenImage}
            disabled={isGenerating}
            className="w-full text-[11px] py-1.5 rounded-lg transition-colors"
            style={{
              background: isGenerating ? 'var(--bg-secondary)' : 'var(--accent-dim)',
              color: isGenerating ? 'var(--text-muted)' : 'var(--accent)',
            }}
          >
            {isGenerating ? '生成中...' : '重新生成图片'}
          </button>

          {/* Delete button */}
          {onRemove && (
            <button
              onClick={onRemove}
              className="w-full text-[11px] py-1.5 rounded-lg transition-colors"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              删除{type === 'characters' ? '角色' : type === 'scenes' ? '场景' : '道具'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
