import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// 设定导入（ADR-0033）的端到端契约：真实启动 server.mjs（匿名本机模式）+ 本地假模型，
// 覆盖分段解析、结构化降级、preset 前置校验、预览不写库、确认后只追加新世界、编号冲突 409。

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

function parse(response) {
  try { return JSON.parse(response.body); } catch { return {}; }
}

/** 假模型：按 behavior 返回；记录每次请求，便于断言调用次数与提示层次。 */
function createFakeModel() {
  const state = { requests: [], behavior: () => ({ status: 200, json: { choices: [{ message: { content: '{}' } }] } }) };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    state.requests.push({ url: req.url, body: parsed, system: parsed.messages?.[0]?.content || '', prompt: parsed.messages?.[1]?.content || '' });
    const { status, json } = state.behavior(parsed, state.requests);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        requests: state.requests,
        setBehavior: fn => { state.behavior = fn; },
        reset: () => { state.requests.length = 0; state.behavior = () => ({ status: 200, json: { choices: [{ message: { content: '{}' } }] } }); },
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

function chunkReply(world = { name: '余烬界', summary: '一座靠炉心余热运转的城邦。', details: '原文对世界的整体描述。' }, entries = []) {
  return { status: 200, json: { choices: [{ message: { content: JSON.stringify({ world, entries }) } }] } };
}

function planEntry(overrides = {}) {
  return {
    type: 'info', name: '灰烬议会', summary: '城邦的实权机构。', details: '灰烬议会由七名议员组成，负责分配炉心余热。',
    attributeA: '势力', attributeB: '', attributeC: '', constraints: [], openQuestions: [], tags: ['议会'], relations: [],
    locationKind: '', locationParent: '', chronicleKind: '', chronicleParent: '', dateLabel: '', order: null,
    truthScope: 'objective',
    ...overrides
  };
}

const initialContent = {
  loreEntries: [
    { id: 'W01', type: 'world', name: '甲世界', worldId: 'W01', status: 'proposed', truthScope: 'objective', values: { summary: '第一世界', details: '' } },
    { id: 'CHR-W01-001', type: 'character', name: '旧角色', worldId: 'W01', status: 'proposed', truthScope: 'objective', values: { details: '旧正文' } }
  ],
  cardDrafts: [],
  keywords: [],
  loreGroups: [],
  notes: {}
};

let server, fakeModel;

before(async () => {
  fakeModel = await createFakeModel();
  const base = await mkdtemp(join(tmpdir(), 'worldforge-lore-import-api-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: {
      ...process.env,
      PORT: String(port),
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: `http://127.0.0.1:${fakeModel.port}/v1`,
      LLM_MODEL: 'fake-model',
      LLM_API_STYLE: 'chat',
      SEEDREAM_API_KEY: '',
      WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
      WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
      WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
      WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
      WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
      WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
    },
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
  server = { child, port, base, output: () => `${stdout}\n${stderr}` };
  const saved = await request(port, '/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Worldforge-Content': '1' }, body: initialContent });
  assert.equal(saved.status, 200, saved.body);
});

after(async () => {
  if (server?.child && server.child.exitCode === null) await new Promise(resolve => { server.child.once('exit', resolve); server.child.kill(); });
  if (fakeModel) await fakeModel.close();
  if (server?.base) await rm(server.base, { recursive: true, force: true });
});

const importHeaders = { 'Content-Type': 'application/json', 'X-Worldforge-Lore-Import': '1' };
// 两段文本：约 8400 字 + 3900 字，段落边界优先，因此稳定切成 2 段。
const longSource = `${'炉心余热维持着城邦的运转。'.repeat(600)}\n\n${'灰烬议会由七名议员组成。'.repeat(300)}`;

test('解析：分段调用模型、不写库、把结果改写成项目资料格式', async () => {
  fakeModel.reset();
  fakeModel.setBehavior((body, requests) => {
    const prompt = body.messages?.[1]?.content || '';
    const index = Number(/index="(\d+)"/.exec(prompt)?.[1] || 1);
    const entries = index === 1
      ? [planEntry({ name: '灰烬议会', tags: ['议会'] }), planEntry({ type: 'character', name: '首席议员', details: '首席议员主持议会。', relations: ['灰烬议会'] })]
      : [planEntry({ name: '灰烬议会', details: '灰烬议会由七名议员组成，负责分配炉心余热。议员不得兼任军职。', constraints: ['议员不得兼任军职'] })];
    return chunkReply({ name: '余烬界', summary: '一座靠炉心余热运转的城邦。', details: '原文对世界的整体描述。' }, entries);
  });
  const before = parse(await request(server.port, '/api/content'));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: longSource, instruction: '势力单独整理' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(fakeModel.requests.length, 2, '两段文本必须各调用一次模型');
  assert.ok(fakeModel.requests.every(item => item.prompt.includes('<worldforge_import_source')), '原文只出现在用户消息侧');
  assert.ok(fakeModel.requests.every(item => item.system.includes('<entry_contract>')), '第 3 层入口契约必须在 system 侧');
  assert.ok(fakeModel.requests.every(item => item.system.includes('整理成资料库条目')));
  assert.ok(fakeModel.requests.every(item => item.prompt.includes('势力单独整理')));

  assert.equal(data.stats.chunks, 2);
  assert.equal(data.worldId, 'W02', '已有 W01 时应分配 W02');
  assert.equal(data.world.name, '余烬界');
  assert.equal(data.agent.presetId, 'lore-writer');
  assert.equal(data.model, 'fake-model');

  const parliament = data.entries.find(entry => entry.name === '灰烬议会');
  assert.ok(parliament, '跨段同名条目必须合并成一条');
  assert.equal(data.entries.filter(entry => entry.name === '灰烬议会').length, 1);
  assert.ok(parliament.values.details.includes('议员不得兼任军职'), '合并后保留补充正文');
  assert.deepEqual(parliament.values.constraints, ['议员不得兼任军职']);
  assert.match(parliament.id, /^INF-W02-\d{3}$/);
  assert.equal(parliament.status, 'proposed');
  assert.equal(parliament.worldId, 'W02');
  const member = data.entries.find(entry => entry.name === '首席议员');
  assert.match(member.id, /^CHR-W02-\d{3}$/);
  assert.deepEqual(member.relationIds, [parliament.id], '关系按名称解析成条目编号');
  assert.ok(data.warnings.some(item => item.code === 'DUPLICATE_MERGED'));
  assert.ok(data.groups.some(group => group.id === 'info' && group.worldId === 'W02'));

  const after = parse(await request(server.port, '/api/content'));
  assert.equal(after.revision, before.revision, '解析不允许写库');
  assert.deepEqual(after.loreEntries.map(entry => entry.id), before.loreEntries.map(entry => entry.id));
});

test('解析：未知 preset 在调用模型前就 400', async () => {
  fakeModel.reset();
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定', presetId: 'does-not-exist' } });
  assert.equal(response.status, 400, response.body);
  assert.equal(fakeModel.requests.length, 0, '不允许产生外部调用');
});

test('解析：结构化输出被拒时降级为非结构化 JSON 并如实回报原因', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(body => {
    if (body.response_format) return { status: 400, json: { error: { message: 'response_format is not supported' } } };
    return chunkReply(undefined, [planEntry({ name: '炉心', attributeA: '技术体系' })]);
  });
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.match(String(data.fallbackReason), /HTTP 400/);
  assert.equal(data.entries[0].name, '炉心');
  assert.equal(fakeModel.requests.length, 2, '结构化请求 + 降级请求各一次');
});

test('解析：全部段落失败时整体报错，而不是返回空计划', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 500, json: { error: { message: 'boom' } } }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定' } });
  assert.equal(response.status, 500, response.body);
  assert.match(String(parse(response).error), /设定解析失败/);
});

test('确认导入：缺标记头 403，成功后只追加一个新世界', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(body => {
    const prompt = body.messages?.[1]?.content || '';
    return chunkReply({ name: '余烬界', summary: '一座靠炉心余热运转的城邦。', details: '' }, /index="2"/.test(prompt)
      ? [planEntry({ name: '灰烬议会', details: '灰烬议会由七名议员组成，负责分配炉心余热。议员不得兼任军职。', constraints: ['议员不得兼任军职'] })]
      : [planEntry({ name: '灰烬议会' }), planEntry({ type: 'character', name: '首席议员', details: '首席议员主持议会。', relations: ['灰烬议会'] })]);
  });
  const parsed = parse(await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: longSource } }));
  const plan = { worldId: parsed.worldId, world: { ...parsed.world, name: '余烬界（作者命名）' }, entries: parsed.entries };

  const forbidden = await request(server.port, '/api/lore-import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { plan } });
  assert.equal(forbidden.status, 403);

  const before = parse(await request(server.port, '/api/content'));
  const response = await request(server.port, '/api/lore-import/commit', { method: 'POST', headers: importHeaders, body: { plan, expectedRevision: before.revision } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(data.worldId, 'W02');
  assert.equal(data.revision, before.revision + 1);

  const after = parse(await request(server.port, '/api/content'));
  assert.deepEqual(after.loreEntries.slice(0, 2).map(entry => entry.id), ['W01', 'CHR-W01-001'], '既有资料必须原样保留在前');
  const world = after.loreEntries.find(entry => entry.id === 'W02');
  assert.ok(world, '必须写入世界条目');
  assert.equal(world.type, 'world');
  assert.equal(world.name, '余烬界（作者命名）');
  assert.equal(world.status, 'proposed');
  const imported = after.loreEntries.filter(entry => entry.worldId === 'W02' && entry.type !== 'world');
  assert.deepEqual(imported.map(entry => entry.name).sort(), ['灰烬议会', '首席议员'].sort());
  assert.ok(imported.every(entry => entry.status === 'proposed'));
  assert.deepEqual(after.loreGroups.map(group => [group.id, group.worldId]), [['info', 'W02']], 'info 资料组随世界落库');
  assert.equal(after.loreEntries.find(entry => entry.name === '首席议员').relationIds.length, 1);
});

test('确认导入：重复使用同一世界编号返回 409', async () => {
  const before = parse(await request(server.port, '/api/content'));
  const response = await request(server.port, '/api/lore-import/commit', {
    method: 'POST', headers: importHeaders,
    body: { plan: { worldId: 'W02', world: { name: '重复世界', summary: '', details: '' }, entries: [] } }
  });
  assert.equal(response.status, 409, response.body);
  const after = parse(await request(server.port, '/api/content'));
  assert.equal(after.revision, before.revision, '失败不得修改内容库');
});

test('确认导入：结构不合格的计划返回 400 而不是写入半套数据', async () => {
  const response = await request(server.port, '/api/lore-import/commit', {
    method: 'POST', headers: importHeaders,
    body: { plan: { worldId: 'W03', world: { name: '半套' }, entries: [{ id: 'LOC-W03-001', type: 'character', name: '', values: {} }] } }
  });
  assert.equal(response.status, 400, response.body);
  const content = parse(await request(server.port, '/api/content'));
  assert.equal(content.loreEntries.some(entry => entry.worldId === 'W03'), false);
});
