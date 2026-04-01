'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#e0e0e0' }}>
          <h2 style={{ marginBottom: 16 }}>出错了</h2>
          <button
            onClick={() => reset()}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#e0e0e0', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
