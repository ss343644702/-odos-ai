import { NextRequest, NextResponse } from 'next/server';
import { uploadFile } from '@/lib/oss';
import { getOrCreateDbUser } from '@/lib/auth';

// Next.js App Router: raise body size limit for video uploads (default ~1MB)
export const maxDuration = 60;

// POST /api/upload — upload media (image/video/gif) to OSS, return URL
export async function POST(request: NextRequest) {
  // Auth: try to get user, but don't block upload if Supabase is slow/unreachable
  let userId = 'anonymous';
  try {
    const user = await Promise.race([
      getOrCreateDbUser(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 5000)),
    ]);
    if (user) userId = user.id;
  } catch {
    // Auth timeout or failure — allow upload with anonymous folder
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Validate: images, video/mp4, GIF
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type === 'video/mp4';
  const isGif = file.type === 'image/gif';
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: 'Only image and MP4 video files are allowed' }, { status: 400 });
  }
  const maxSize = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024; // 50MB for video, 5MB for images/GIF
  if (file.size > maxSize) {
    return NextResponse.json({ error: `File size must be under ${isVideo ? '50' : '5'}MB` }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `uploads/${userId}/${Date.now()}.${ext}`;
    const url = await uploadFile(buffer, filename, file.type);
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
