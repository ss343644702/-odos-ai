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
