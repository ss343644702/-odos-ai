'use client';

import { useState, useEffect } from 'react';

const BUTTERFLY_MESSAGES = [
  '你的选择产生了蝴蝶效应…',
  '一只蝴蝶在热带雨林振翅…',
  '扰动周围空气分子…',
  '产生微弱局部气流…',
  '气流带动空气波动…',
  '波动形成小型涡旋…',
  '涡旋随大气环流扩散…',
  '改变低空局部风向…',
  '影响区域气压分布…',
  '推动暖湿空气向海移动…',
  '加快海面水汽蒸发…',
  '增加海洋上空水汽…',
  '水汽聚成细碎云层…',
  '云层合并为密集云团…',
  '云团发展为对流积云…',
  '积云增强为厚重积雨云…',
  '积雨云引发近海降雨…',
  '降雨改变沿海地表风场…',
  '风场牵引远洋气旋偏移…',
  '气旋路径影响远方天气…',
  '微小扰动造成显著气象差异…',
];

export default function ButterflyLoading() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % BUTTERFLY_MESSAGES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex-1 flex items-center gap-2 px-4 py-3">
      <span className="animate-spin text-xs" style={{ color: 'var(--accent)' }}>⟳</span>
      <span
        className="text-sm transition-opacity duration-500"
        style={{ color: 'var(--accent)' }}
        key={index}
      >
        {BUTTERFLY_MESSAGES[index]}
      </span>
    </div>
  );
}
