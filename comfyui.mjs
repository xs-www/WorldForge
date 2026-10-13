import { randomUUID } from 'node:crypto';

const DEFAULT_BASE_URL = 'http://host.docker.internal:8188';
const WAIT_MS = 1000;
const MAX_POLLS = 180;

export function comfyUiConfig(env = process.env) {
  return { baseUrl: (env.COMFYUI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '') };
}

export function validateComfyUiSettings(payload) {
  const baseUrl = String(payload.comfyUiBaseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl) || baseUrl.length > 500) throw new Error('ComfyUI Base URL 必须是有效的 HTTP(S) 地址');
  let workflow;
  if (payload.comfyUiWorkflow !== undefined) {
    const source = String(payload.comfyUiWorkflow).trim();
    if (!source) workflow = null;
    else {
      try { workflow = JSON.parse(source); } catch { throw new Error('ComfyUI 工作流不是有效 JSON'); }
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('ComfyUI 工作流必须是 API Format 对象');
      if (!source.includes('{{PROMPT}}')) throw new Error('ComfyUI 工作流必须包含 {{PROMPT}} 占位符');
    }
  }
  return { baseUrl, workflow };
}

function dimensions(size) {
  if (size === '1248x1872') return { width: 1248, height: 1872 };
  if (size === '1872x1248') return { width: 1872, height: 1248 };
  return { width: 1536, height: 1024 };
}

export function fillComfyWorkflow(template, request) {
  const { width, height } = dimensions(request.size);
  const seed = Number.isSafeInteger(request.seed) ? request.seed : Math.floor(Math.random() * 2147483647);
  const substitutions = { '{{PROMPT}}': request.prompt, '{{NEGATIVE_PROMPT}}': request.negativePrompt || 'text, logo, UI, card frame, numbers, low quality', '{{WIDTH}}': width, '{{HEIGHT}}': height, '{{SEED}}': seed };
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    if (typeof value !== 'string') return value;
    if (Object.hasOwn(substitutions, value)) return substitutions[value];
    return value.replace(/\{\{PROMPT\}\}/g, request.prompt).replace(/\{\{NEGATIVE_PROMPT\}\}/g, request.negativePrompt || 'text, logo, UI, card frame, numbers, low quality');
  };
  return { workflow: visit(template), seed, width, height };
}

function firstImage(history) {
  for (const output of Object.values(history?.outputs || {})) {
    const image = output?.images?.find(item => item?.filename);
    if (image) return image;
  }
  return null;
}

export async function generateComfyUiImage(config, template, request, fetchImpl = fetch, waitImpl = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!template) throw new Error('尚未配置 ComfyUI API Format 工作流');
  const filled = fillComfyWorkflow(template, request);
  const queueResponse = await fetchImpl(`${config.baseUrl}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: filled.workflow, client_id: `worldforge-${randomUUID()}` }), signal: AbortSignal.timeout(30000)
  });
  const queued = await queueResponse.json().catch(() => ({}));
  if (!queueResponse.ok || !queued.prompt_id) throw new Error(queued.error?.message || queued.error || `ComfyUI 入队失败：${queueResponse.status}`);
  let image;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const historyResponse = await fetchImpl(`${config.baseUrl}/history/${encodeURIComponent(queued.prompt_id)}`, { signal: AbortSignal.timeout(10000) });
    const historyData = await historyResponse.json().catch(() => ({}));
    if (!historyResponse.ok) throw new Error(`读取 ComfyUI 任务失败：${historyResponse.status}`);
    const record = historyData[queued.prompt_id] || historyData;
    if (record?.status?.status_str === 'error') throw new Error('ComfyUI 工作流执行失败');
    image = firstImage(record);
    if (image) break;
    await waitImpl(WAIT_MS);
  }
  if (!image) throw new Error('ComfyUI 生成超时或没有输出图片；工作流需包含 Save Image/Preview Image 输出');
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
  const imageResponse = await fetchImpl(`${config.baseUrl}/view?${query}`, { signal: AbortSignal.timeout(60000) });
  if (!imageResponse.ok) throw new Error(`下载 ComfyUI 图片失败：${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error('ComfyUI 图片数据大小无效');
  return {
    request, bytes, mimeType: imageResponse.headers?.get?.('content-type')?.split(';')[0] || 'image/png',
    providerMetadata: { promptId: queued.prompt_id, seed: filled.seed, width: filled.width, height: filled.height, output: image }
  };
}

export const COMFYUI_DEFAULTS = { baseUrl: DEFAULT_BASE_URL };
