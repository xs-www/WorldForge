import test from 'node:test';
import assert from 'node:assert/strict';
import { fillComfyWorkflow, generateComfyUiImage, validateComfyUiSettings } from '../comfyui.mjs';

const template = { '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}' } }, '2': { class_type: 'EmptyLatentImage', inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}' } }, '3': { class_type: 'KSampler', inputs: { seed: '{{SEED}}' } } };

test('ComfyUI settings require an API-format prompt placeholder', () => {
  assert.throws(() => validateComfyUiSettings({ comfyUiWorkflow: '{}' }), /PROMPT/);
  const value = validateComfyUiSettings({ comfyUiBaseUrl: 'http://127.0.0.1:8188/', comfyUiWorkflow: JSON.stringify(template) });
  assert.equal(value.baseUrl, 'http://127.0.0.1:8188');
  assert.deepEqual(value.workflow, template);
});

test('ComfyUI workflow placeholders preserve numeric inputs', () => {
  const result = fillComfyWorkflow(template, { prompt: '原创魔导列车', size: '1872x1248', seed: 42 });
  assert.equal(result.workflow['1'].inputs.text, '原创魔导列车');
  assert.equal(result.workflow['2'].inputs.width, 1872);
  assert.equal(result.workflow['3'].inputs.seed, 42);
});

test('ComfyUI generation queues, polls and downloads without external calls', async () => {
  const urls = [];
  const fetchMock = async url => {
    urls.push(url);
    if (url.endsWith('/prompt')) return { ok: true, status: 200, json: async () => ({ prompt_id: 'job-1' }) };
    if (url.endsWith('/history/job-1')) return { ok: true, status: 200, json: async () => ({ 'job-1': { outputs: { '9': { images: [{ filename: 'card.png', subfolder: 'wf', type: 'output' }] } } } }) };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('png'), headers: { get: () => 'image/png' } };
  };
  const result = await generateComfyUiImage({ baseUrl: 'http://127.0.0.1:8188' }, template, { prompt: '原创世界', size: '2K', cardId: 'CARD-W01-DRAFT-1', seed: 7 }, fetchMock, async () => {});
  assert.equal(result.bytes.toString(), 'png');
  assert.equal(result.providerMetadata.promptId, 'job-1');
  assert.match(urls[2], /\/view\?/);
});
