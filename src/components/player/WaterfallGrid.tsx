'use client';

import StoryCard from './StoryCard';

interface StoryItem {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  authorName: string;
  authorAvatar: string | null;
  playCount: number;
}

interface WaterfallGridProps {
  stories: StoryItem[];
}

export default function WaterfallGrid({ stories }: WaterfallGridProps) {
  // Split into 2 columns for waterfall effect
  const col1: StoryItem[] = [];
  const col2: StoryItem[] = [];
  stories.forEach((s, i) => {
    if (i % 2 === 0) col1.push(s);
    else col2.push(s);
  });

  return (
    <div className="flex gap-3 px-3">
      <div className="flex-1 space-y-3">
        {col1.map((story) => (
          <StoryCard key={story.id} {...story} />
        ))}
      </div>
      <div className="flex-1 space-y-3">
        {col2.map((story) => (
          <StoryCard key={story.id} {...story} />
        ))}
      </div>
    </div>
  );
}
