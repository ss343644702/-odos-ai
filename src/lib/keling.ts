// 可灵 v3 Omini API Client
// 使用 JWT (access_key + secret_key) 鉴权

const KELING_BASE_URL = process.env.KELING_BASE_URL || 'https://api-beijing.klingai.com';
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY || '';
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY || '';

// --- JWT Generation (HMAC-SHA256) ---

function base64url(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateJWT(): string {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(
    Buffer.from(JSON.stringify({
      iss: KLING_ACCESS_KEY,
      exp: now + 1800, // 30 minutes
      nbf: now - 5,
      iat: now,
    })),
  );
  const signature = base64url(
    crypto.createHmac('sha256', KLING_SECRET_KEY).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

// --- API Types ---

interface KelingGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: '1:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3';
  image_fidelity?: 'low' | 'normal' | 'high';
  model_name?: string;
  image_list?: { image: string }[];
}

interface KelingTaskResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: string;
  };
}

interface KelingResultResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_result?: {
      images: { url: string; index: number }[];
    };
  };
}

// --- API Functions ---

export async function submitImageGeneration(params: KelingGenerateRequest): Promise<string> {
  const token = generateJWT();

  const body: Record<string, any> = {
    model_name: params.model_name || 'kling-image-o1',
    prompt: params.prompt,
    n: 1,
    aspect_ratio: params.aspect_ratio || '16:9',
    image_fidelity: params.image_fidelity || 'normal',
  };

  if (params.negative_prompt) {
    body.negative_prompt = params.negative_prompt;
  }

  if (params.image_list && params.image_list.length > 0) {
    body.image_list = params.image_list;
  }

  const response = await fetch(`${KELING_BASE_URL}/v1/images/omni-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const result: KelingTaskResponse = await response.json();

  if (result.code !== 0) {
    throw new Error(`Keling API error: ${result.message}`);
  }

  return result.data.task_id;
}

export async function queryImageResult(taskId: string): Promise<{
  status: string;
  imageUrl?: string;
}> {
  const token = generateJWT();

  const response = await fetch(`${KELING_BASE_URL}/v1/images/omni-image/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const result: KelingResultResponse = await response.json();

  if (result.data.task_status === 'succeed' && result.data.task_result?.images?.[0]) {
    return {
      status: 'completed',
      imageUrl: result.data.task_result.images[0].url,
    };
  }

  return {
    status: result.data.task_status,
  };
}

export async function pollImageResult(
  taskId: string,
  opts?: { maxAttempts?: number; initialDelay?: number },
): Promise<{ status: string; imageUrl?: string }> {
  const maxAttempts = opts?.maxAttempts || 15;
  let delay = opts?.initialDelay || 2000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delay));
    const result = await queryImageResult(taskId);
    if (result.status === 'completed' && result.imageUrl) return result;
    if (result.status === 'failed') return result;
    delay = Math.min(delay * 1.3, 5000);
  }
  return { status: 'timeout' };
}

export async function generateImageWithPolling(
  params: KelingGenerateRequest,
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<string> {
  const taskId = await submitImageGeneration(params);
  const result = await pollImageResult(taskId, { maxAttempts, initialDelay: intervalMs });
  if (result.status === 'completed' && result.imageUrl) return result.imageUrl;
  if (result.status === 'failed') throw new Error('Image generation failed');
  throw new Error('Image generation timeout');
}
