'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StoryNodeData, NodeType } from '@/types/story';

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

type StoryNodeProps = NodeProps & {
  data: StoryNodeData & { nodeType: NodeType };
};

function StoryNodeComponent({ data, selected }: StoryNodeProps) {
  const color = nodeColors[data.nodeType] || nodeColors.scene;
  const label = nodeLabels[data.nodeType] || '场景';

  // Story config node — special compact render, no handles
  if (data.nodeType === 'story_config') {
    return (
      <div
        className="relative group"
        style={{ minWidth: 200, maxWidth: 240 }}
      >
        <div
          className="rounded-xl overflow-hidden transition-all px-4 py-3"
          style={{
            background: 'var(--bg-secondary)',
            border: `2px solid ${selected ? color : 'var(--border)'}`,
            boxShadow: selected ? `0 0 20px ${color}40` : 'none',
            minWidth: 180,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}20`, color }}>{label}</span>
              <p className="text-xs mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{data.title || '故事设定'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const thumbnailUrl = (data as any).frames?.[0]?.imageUrl || data.imageUrl;
  const frameCount = (data as any).frames?.length || 0;

  // Render output handles
  const renderOutputHandles = () => {
    if (data.choices && data.choices.length > 0) {
      return data.choices.map((choice, i) => (
        <Handle
          key={choice.id}
          type="source"
          position={Position.Right}
          id={choice.id}
          className="!w-3 !h-3 !border-2"
          style={{
            background: color,
            borderColor: 'var(--bg-primary)',
            top: `${((i + 1) / (data.choices.length + 1)) * 100}%`,
          }}
        />
      ));
    }
    if (data.nodeType !== 'ending') {
      return (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !border-2"
          style={{ background: color, borderColor: 'var(--bg-primary)' }}
        />
      );
    }
    return null;
  };

  return (
    <div
      className="relative group"
      style={{
        minWidth: 200,
        maxWidth: 240,
      }}
    >
      {/* Input handle (left) — not for start */}
      {data.nodeType !== 'start' && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !border-2"
          style={{ background: color, borderColor: 'var(--bg-primary)' }}
        />
      )}

      {/* Node card */}
      <div
        className="rounded-xl overflow-hidden transition-all"
        style={{
          background: 'var(--bg-secondary)',
          border: `2px solid ${selected ? color : 'var(--border)'}`,
          boxShadow: selected ? `0 0 20px ${color}40` : 'none',
        }}
      >
        {/* Image thumbnail */}
        <div
          className="w-full h-24 flex items-center justify-center text-xs relative"
          style={{
            background: thumbnailUrl
              ? `url(${thumbnailUrl}) center/cover`
              : `linear-gradient(135deg, ${color}20, ${color}05)`,
            color: 'var(--text-muted)',
          }}
        >
          {!thumbnailUrl && (
            <div className="flex flex-col items-center gap-1">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span>待生成</span>
            </div>
          )}
          {frameCount > 1 && (
            <span
              className="absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.7)', color: 'white' }}
            >
              {frameCount} 帧
            </span>
          )}
        </div>

        {/* Node info */}
        <div className="p-3">
          {/* Type badge + depth */}
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: `${color}20`, color }}
            >
              {label}
            </span>
            {data.depth !== undefined && (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                L{data.depth}
              </span>
            )}
          </div>

          {/* Title */}
          <div
            className="text-sm font-medium truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {data.title || '未命名节点'}
          </div>

          {/* Narration preview */}
          <div
            className="text-xs mt-1 line-clamp-2 leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {data.narration || '暂无描述...'}
          </div>

          {/* Choices count */}
          {data.choices && data.choices.length > 0 && (
            <div
              className="flex items-center gap-1 mt-2 text-[10px]"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 3v12" /><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                <path d="M15 6a9 9 0 0 0-9 9" />
              </svg>
              {data.choices.length} 个分支
            </div>
          )}

          {data.choices?.some((c: any) => c.visibility === 'hidden') && (
            <div className="flex items-center gap-1 mt-1 text-[10px]" style={{ color: '#ffa500' }}>
              🔒 {data.choices.filter((c: any) => c.visibility === 'hidden').length}个隐藏选项
            </div>
          )}

          {data.allowCustomInput && (
            <div
              className="flex items-center gap-1 mt-1 text-[10px]"
              style={{ color: 'var(--accent)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              允许自由输入
            </div>
          )}
        </div>
      </div>

      {/* Output handles (right) */}
      {renderOutputHandles()}
    </div>
  );
}

export default memo(StoryNodeComponent);
