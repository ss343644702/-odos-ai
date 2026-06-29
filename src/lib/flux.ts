// FLUX.2 image generation client — Black Forest Labs (BFL) API.
// Custom (non-OpenAI) protocol: submit returns { id, polling_url }; the polling_url host is
// region-specific (eu2/us2/us3…) and MUST be used for polling. We carry it through the existing
// string-taskId contract by base64url-encoding it (query-param safe → call sites unchanged).
//
// Provider-agnostic env (swap to change provider/model without code changes):
//   IMAGE_API_KEY  — BFL key (server-only, NOT NEXT_PUBLIC → never shipped to browser)
//   IMAGE_BASE_URL — default https://api.bfl.ai
//   IMAGE_MODEL    — default flux-2-klein-9b-preview
//
// Param shape stays Kling-compatible (aspect_ratio, image_list…) so the 4 call sites that used
// the old keling client need only swap the import path.

const IMAGE_API_KEY = process.env.IMAGE_API_KEY || '';
const IMAGE_BASE_URL = (process.env.IMAGE_BASE_URL || 'https://api.bfl.ai').replace(/\/$/, '');
export const IMAGE_MODEL = process.env.IMAGE_MODEL || 'flux-2-klein-9b-preview';

// Kling-compatible request shape (image_fidelity is Kling-only and ignored here).
interface ImageGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: '1:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3';
  image_fidelity?: 'low' | 'normal' | 'high';
  model_name?: string;
  image_list?: { image: string }[];
}

// FLUX.2 takes width/height (multiples of 32). Map the aspect ratios the app uses.
const ASPECT_TO_WH: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1024, 576],
  '9:16': [576, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '3:2': [1024, 672],
  '2:3': [672, 1024],
};

/** Fetch a remote image URL and convert to a data URI (BFL reference images need base64). */
async function urlToDataUri(url: string): Promise<string | null> {
  try {
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function submitImageGeneration(params: ImageGenerateRequest): Promise<string> {
  const model = params.model_name || IMAGE_MODEL;
  const [width, height] = ASPECT_TO_WH[params.aspect_ratio || '9:16'] || ASPECT_TO_WH['9:16'];

  const body: Record<string, any> = { prompt: params.prompt, width, height };

  // Reference images (character/scene consistency) → input_image, input_image_2, input_image_3.
  // FLUX.2 uses numbered fields (array form is rejected). Max 3, mirroring getEntityImageList.
  const refs = params.image_list || [];
  if (refs.length > 0) {
    const dataUris = (await Promise.all(
      refs.slice(0, 3).map((r) => urlToDataUri(r.image)),
    )).filter(Boolean) as string[];
    dataUris.forEach((uri, i) => {
      body[i === 0 ? 'input_image' : `input_image_${i + 1}`] = uri;
    });
  }

  const response = await fetch(`${IMAGE_BASE_URL}/v1/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': IMAGE_API_KEY },
    body: JSON.stringify(body),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data?.polling_url) {
    const detail = data?.detail || data?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(`FLUX API error: ${response.status} - ${detail}`);
  }

  // Carry the region-specific polling_url through the string-taskId contract (base64url = URL-safe).
  return Buffer.from(String(data.polling_url)).toString('base64url');
}

export async function queryImageResult(taskId: string, _endpoint?: string): Promise<{
  status: string;
  imageUrl?: string;
}> {
  let pollingUrl: string;
  try {
    pollingUrl = Buffer.from(taskId, 'base64url').toString('utf8');
    if (!/^https?:\/\//.test(pollingUrl)) return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }

  const response = await fetch(pollingUrl, { headers: { 'x-key': IMAGE_API_KEY } });
  const data: any = await response.json().catch(() => ({}));
  const status = data?.status;

  if (status === 'Ready' && data?.result?.sample) {
    return { status: 'completed', imageUrl: data.result.sample };
  }
  // Content moderation rejection — distinct from generic failure: retrying won't help,
  // the user must adjust the prompt. Surfaced separately so the UI can say so.
  if (status === 'Content Moderated' || status === 'Request Moderated') {
    return { status: 'moderated' };
  }
  // Other terminal failures
  if (['Error', 'Task not found'].includes(status)) {
    return { status: 'failed' };
  }
  // Pending / Queued / Processing …
  return { status: 'pending' };
}

export async function pollImageResult(
  taskId: string,
  opts?: { maxAttempts?: number; initialDelay?: number; endpoint?: string },
): Promise<{ status: string; imageUrl?: string }> {
  const maxAttempts = opts?.maxAttempts || 15;
  let delay = opts?.initialDelay || 2000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delay));
    const result = await queryImageResult(taskId, opts?.endpoint);
    if (result.status === 'completed' && result.imageUrl) return result;
    if (result.status === 'failed' || result.status === 'moderated') return result;
    delay = Math.min(delay * 1.3, 5000);
  }
  return { status: 'timeout' };
}

export async function generateImageWithPolling(
  params: ImageGenerateRequest,
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<string> {
  const taskId = await submitImageGeneration(params);
  const result = await pollImageResult(taskId, { maxAttempts, initialDelay: intervalMs });
  if (result.status === 'completed' && result.imageUrl) return result.imageUrl;
  if (result.status === 'failed') throw new Error('Image generation failed');
  throw new Error('Image generation timeout');
}
