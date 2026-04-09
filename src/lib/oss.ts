import OSS from 'ali-oss';

let client: OSS | null = null;

function getClient(): OSS {
  if (!client) {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
    const bucket = process.env.OSS_BUCKET;

    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new Error('OSS credentials not configured. Set OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET in .env.local');
    }

    client = new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      region: process.env.OSS_REGION || 'oss-cn-beijing',
      endpoint: process.env.OSS_ENDPOINT || 'oss-cn-beijing.aliyuncs.com',
    });
  }
  return client;
}

export async function uploadAudio(buffer: Buffer, filename: string): Promise<string> {
  const ossClient = getClient();
  const key = `tts/${filename}`;
  const result = await ossClient.put(key, buffer, {
    headers: { 'Content-Type': 'audio/mpeg' },
  });
  return result.url;
}

export async function uploadFile(buffer: Buffer, filename: string, contentType: string): Promise<string> {
  const ossClient = getClient();

  // Large files (>2MB): use multipart upload for reliability
  if (buffer.length > 2 * 1024 * 1024) {
    const fs = require('fs');
    const tmpPath = `/tmp/oss_upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmpPath, buffer);
    try {
      await ossClient.multipartUpload(filename, tmpPath, {
        headers: { 'Content-Type': contentType },
        timeout: 120000,
      });
      const bucket = process.env.OSS_BUCKET || 'odosai';
      const endpoint = process.env.OSS_ENDPOINT || 'oss-cn-beijing.aliyuncs.com';
      return `http://${bucket}.${endpoint}/${filename}`;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  // Small files: simple upload
  const result = await ossClient.put(filename, buffer, {
    headers: { 'Content-Type': contentType },
  });
  return result.url;
}

/**
 * Download image from a temporary URL (e.g. Keling CDN) and re-upload to OSS for permanent storage.
 * Returns the permanent OSS URL. If download/upload fails, returns the original URL as fallback.
 */
export async function persistImageUrl(sourceUrl: string): Promise<string> {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return sourceUrl;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const key = `frames/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return await uploadFile(buffer, key, contentType);
  } catch {
    return sourceUrl; // fallback: return original URL
  }
}
