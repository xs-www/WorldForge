import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedreamBody, generateSeedreamImage, validateImageRequest, validateSeedreamSettings } from '../seedream.mjs';

const config = { key: 'test-key', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-flash-260915' };

test('Seedream settings and card art requests enforce the Ark boundary', () => {
  assert.equal(validateSeedreamSettings({}).model, config.model);
  assert.throws(() => validateSeedreamSettings({ seedreamBaseUrl: 'https://example.com/api/v3' }), /火山方舟/);
  assert.throws(() => validateImageRequest({ prompt: '', size: '1872x1248', cardId: 'CARD-W01-DRAFT-1' }), /提示词/);
  assert.throws(() => validateImageRequest({ prompt: 'x', size: '512x512', cardId: 'CARD-W01-DRAFT-1' }), /尺寸/);
  const reference='data:image/png;base64,aGVsbG8=';
  const body = buildSeedreamBody(config, { prompt: '魔导列车', size: '2K', referenceImages:[reference] });
  assert.equal(body.response_format, 'url');
  assert.equal(body.watermark, true);
  assert.match(body.prompt, /不要文字/);
  assert.equal(body.image,reference);
});

test('Seedream generation downloads a mocked URL image without external calls', async () => {
  const requestedUrls = [];
  const fetchMock = async (url, options = {}) => {
    requestedUrls.push(url);
    if (url === 'https://image.example/output.jpg') return { ok: true, arrayBuffer: async () => Buffer.from('fake-image'), headers: { get: () => 'image/jpeg' } };
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.model);
    return { ok: true, json: async () => ({ created: 1, data: [{ url: 'https://image.example/output.jpg', size: body.size }], usage: { generated_images: 1 } }) };
  };
  const result = await generateSeedreamImage(config, { prompt: '原创魔导机械师', size: '2K', cardId: 'CARD-W01-DRAFT-1' }, fetchMock);
  assert.deepEqual(requestedUrls, [
    'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    'https://image.example/output.jpg'
  ]);
  assert.equal(result.bytes.toString(), 'fake-image');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.providerMetadata.usage.generated_images, 1);
});
