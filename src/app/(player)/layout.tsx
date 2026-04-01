import BottomTabBar from '@/components/player/BottomTabBar';

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[430px] mx-auto min-h-screen relative" style={{ background: 'var(--bg-primary)' }}>
      {children}
      <BottomTabBar />
    </div>
  );
}
