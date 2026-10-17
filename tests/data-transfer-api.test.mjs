import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';

// 数据导入 / 导出的端到端契约：真实启动 server.mjs（匿名本机模式），
// 验证整包导出、预检不写库、合并/替换两种模式的落库结果与请求标记门禁。

const repositoryRoot = new URL('../', import.meta.url);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { ...process.env, PORT: String(port), LLM_API_KEY: '', SEEDREAM_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未就绪\n${stdout}\n${stderr}`)), 15000);
    const poll = () => {
      if (/http:\/\/127\.0\.0\.1:\d+/.test(stdout)) { clearTimeout(timer); resolve(); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务提前退出（${child.exitCode}）\n${stderr}`)); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
  return { child, port, output: () => `${stdout}\n${stderr}`, close: () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); }) };
}

function parse(response) {
  try { return JSON.parse(response.body); } catch { return {}; }
}

const initialContent = {
  loreEntries: [
    { id: 'W01', type: 'world', name: '甲世界', worldId: 'W01', status: 'proposed', truthScope: 'objective', summary: '第一世界' },
    { id: 'FAC-W01-001', type: 'faction', name: '旧势力', worldId: 'W01', status: 'proposed', truthScope: 'objective' }
  ],
  cardDrafts: [{ id: 'CARD-W01-DRAFT-1', name: '旧卡', type: 'minion', worldId: 'W01' }],
  keywords: [{ id: 'KEY-001', name: '疾启', definition: '进入战场时立即行动。' }],
  loreGroups: [{ id: 'faction', label: '势力', form: 'generic', attributes: ['类型', '首领', '据点'] }],
  notes: { 'FAC-W01-001': '待裁定' }
};

let server;

before(async () => {
  const base = await mkdtemp(join(tmpdir(), 'worldforge-transfer-api-'));
  server = { ...(await startServer({
    WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
    WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
    WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
    WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
    WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
    WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
  })), base };
  const saved = await request(server.port, '/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Worldforge-Content': '1' }, body: initialContent });
  assert.equal(saved.status, 200, saved.body);
});

after(async () => {
  if (server) await server.close();
  if (server?.base) await rm(server.base, { recursive: true, force: true });
});

const importHeaders = { 'Content-Type': 'application/json', 'X-Worldforge-Import': '1' };

test('导出返回整库交换格式，并带下载响应头', async () => {
  const response = await request(server.port, '/api/export');
  assert.equal(response.status, 200);
  assert.match(String(response.headers['content-disposition']), /attachment; filename="worldforge-export-/);
  const bundle = parse(response);
  assert.equal(bundle.format, 'worldforge-export');
  assert.equal(bundle.formatVersion, 1);
  assert.deepEqual(bundle.content.loreEntries.map(item => item.id), ['W01', 'FAC-W01-001']);
  assert.equal(bundle.content.loreGroups[0].label, '势力');
  assert.deepEqual(bundle.images, []);
  // 导出必须反映服务端真值，而不是浏览器缓存。
  assert.equal(bundle.revision, 1);
});

test('带 ?images=1 时附带内嵌图片数组（没有资产时为空）', async () => {
  const response = await request(server.port, '/api/export?images=1');
  assert.equal(response.status, 200);
  assert.deepEqual(parse(response).images, []);
});

test('导入缺少请求标记时直接 403', async () => {
  const response = await request(server.port, '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { payload: {} } });
  assert.equal(response.status, 403);
});

test('预检只给统计，不写库', async () => {
  const payload = { content: { loreEntries: [{ id: 'CHR-W01-001', type: 'character', name: '新角色', worldId: 'W01' }], cardDrafts: [], keywords: [], loreGroups: [], notes: {} } };
  const response = await request(server.port, '/api/import', { method: 'POST', headers: importHeaders, body: { mode: 'merge', dryRun: true, payload } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(data.dryRun, true);
  assert.deepEqual(data.summary.loreEntries, { added: 1, updated: 0, total: 3 });
  const afterPreview = parse(await request(server.port, '/api/content'));
  assert.deepEqual(afterPreview.loreEntries.map(item => item.id), ['W01', 'FAC-W01-001']);
  assert.equal(afterPreview.revision, 1);
});

test('合并导入按 ID 覆盖、新增，并保留未提及的条目', async () => {
  const payload = {
    content: {
      loreEntries: [{ id: 'FAC-W01-001', type: 'faction', name: '新势力', worldId: 'W01' }, { id: 'CHR-W01-001', type: 'character', name: '新角色', worldId: 'W01' }],
      cardDrafts: [], keywords: [], loreGroups: [], notes: { 'FAC-W01-001': '已裁定' }
    }
  };
  const response = await request(server.port, '/api/import', { method: 'POST', headers: importHeaders, body: { mode: 'merge', payload } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(data.dryRun, false);
  assert.deepEqual(data.summary.loreEntries, { added: 1, updated: 1, total: 3 });
  const content = parse(await request(server.port, '/api/content'));
  assert.equal(content.loreEntries.find(item => item.id === 'FAC-W01-001').name, '新势力');
  assert.equal(content.loreEntries.find(item => item.id === 'W01').name, '甲世界');
  assert.equal(content.notes['FAC-W01-001'], '已裁定');
  // 卡牌、关键词与资料组不在本次导入包里，必须原样保留。
  assert.deepEqual(content.cardDrafts.map(item => item.id), ['CARD-W01-DRAFT-1']);
  assert.deepEqual(content.keywords.map(item => item.id), ['KEY-001']);
  assert.deepEqual(content.loreGroups.map(item => item.id), ['faction']);
  assert.equal(content.revision, 2);
});

test('替换导入整库覆盖资料，但美术资产不受影响', async () => {
  const payload = {
    content: {
      loreEntries: [{ id: 'W09', type: 'world', name: '新宇宙', worldId: 'W09' }],
      cardDrafts: [], keywords: [], loreGroups: [{ id: 'homebrew', label: '自建组', form: 'generic', attributes: ['一', '二', '三'] }], notes: {}
    },
    artAssets: []
  };
  const response = await request(server.port, '/api/import', { method: 'POST', headers: importHeaders, body: { mode: 'replace', payload } });
  assert.equal(response.status, 200, response.body);
  const content = parse(await request(server.port, '/api/content'));
  assert.deepEqual(content.loreEntries.map(item => item.id), ['W09']);
  assert.deepEqual(content.cardDrafts, []);
  assert.deepEqual(content.loreGroups.map(item => item.id), ['homebrew']);
  assert.deepEqual(content.notes, {});
  assert.equal(content.revision, 3);
});

test('结构不合格的导入文件返回 400 而不是 500', async () => {
  const response = await request(server.port, '/api/import', { method: 'POST', headers: importHeaders, body: { mode: 'merge', payload: { content: { loreEntries: 'nope' } } } });
  assert.equal(response.status, 400, response.body);
  assert.match(String(parse(response).error), /loreEntries/);
});

test('导出 / 导入的路由不会命中其他 API 分支', async () => {
  const health = parse(await request(server.port, '/api/health'));
  assert.equal(health.status, 'ok');
  assert.equal(health.database.driver, undefined);
  assert.equal(health.database.ok, true);
  assert.equal(health.database.databasePath, undefined);
  assert.equal(health.database.schemaVersion, 3);
});

test('原画跟随目标世界：列表与导出带 worldId，解除绑定后清空（ADR-0034）', async () => {
  const saved = await request(server.port, '/api/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Content': '1' },
    body: {
      expectedRevision: 3,
      loreEntries: [{ id: 'W09', type: 'world', name: '新宇宙', worldId: 'W09', status: 'proposed', truthScope: 'objective' }],
      cardDrafts: [{ id: 'CARD-W09-0001', name: '新宇宙的卡', type: 'minion', worldId: 'W09' }],
      keywords: [], loreGroups: [], notes: {}
    }
  });
  assert.equal(saved.status, 200, saved.body);

  const asset = { id: 'ART-AAAA-BBBB', targetType: 'card', targetId: 'CARD-W09-0001', purpose: 'card_art', prompt: '提示词', model: 'seedream', size: '2K', mimeType: 'image/png', fileName: 'ART-AAAA-BBBB.png', status: 'proposed', createdAt: '2026-10-21T00:00:00.000Z' };
  const imported = await request(server.port, '/api/import', { method: 'POST', headers: importHeaders, body: { mode: 'merge', payload: { artAssets: [asset] } } });
  assert.equal(imported.status, 200, imported.body);

  const listed = parse(await request(server.port, '/api/art-assets'));
  assert.equal(listed.assets.length, 1);
  // 服务端按绑定目标现算世界：导入包里的资产元数据没有 worldId，也必须出现在正确的世界下。
  assert.equal(listed.assets[0].worldId, 'W09');

  const exported = parse(await request(server.port, '/api/export'));
  assert.equal(exported.artAssets[0].worldId, 'W09', '导出必须带上世界归属');

  const unbound = await request(server.port, '/api/art-assets/ART-AAAA-BBBB/unbind', { method: 'POST', headers: { 'X-Worldforge-Image': '1' } });
  assert.equal(unbound.status, 200, unbound.body);
  assert.equal(parse(await request(server.port, '/api/art-assets')).assets[0].worldId, '', '解除绑定后不再属于任何世界');
});
