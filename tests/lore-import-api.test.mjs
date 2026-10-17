import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { docxBytes, zipBytes } from './helpers/document-fixtures.mjs';

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

test('解析：不再依赖结构化输出，记录格式一次调用即可落成条目', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({
    status: 200,
    json: { choices: [{ message: { content: '@@ 世界\n名称：余烬界\n概述：一座靠炉心余热运转的城邦。\n\n@@ 条目\n类型：info\n名称：灰烬议会\n概述：城邦机构\n正文：\n七名议员负责分配余热。\n不得兼任军职。\n属性一：势力\n标签：议会、议员\n' } }] }
  }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(fakeModel.requests.length, 1, '一次调用，没有结构化降级重试');
  assert.equal(fakeModel.requests[0].body.response_format, undefined, '导入入口不得发送 json_schema');
  assert.equal(fakeModel.requests[0].body.text, undefined, '响应不应依赖 text.format');
  assert.deepEqual(data.entries.map(item => item.name), ['灰烬议会']);
  assert.equal(data.entries[0].values.attributeA, '势力');
  assert.deepEqual(data.entries[0].tags, ['议会', '议员']);
  assert.equal(data.world.name, '余烬界');
  assert.match(String(data.normalization?.formats?.[0]), /record|json/);
});

test('解析：全部段落失败时整体报错，而不是返回空计划', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 500, json: { error: { message: 'boom' } } }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定' } });
  assert.equal(response.status, 500, response.body);
  assert.match(String(parse(response).error), /设定解析失败/);
});

test('解析：模型输出未转义换行时仍能落成条目（deepseek-flash 实测形态）', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({
    status: 200,
    json: { choices: [{ message: { content: '{"world":{"name":"余烬界","summary":"","details":""},"entries":[{"type":"info","name":"灰烬议会","summary":"机构","details":"第一行\n第二行","attributeA":"势力","attributeB":"","attributeC":"","constraints":[],"openQuestions":[],"tags":[],"relations":[],"locationKind":"","locationParent":"","chronicleKind":"","chronicleParent":"","dateLabel":"","order":null,"truthScope":"objective"}]}' } }] }
  }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '灰烬议会由七名议员组成。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.deepEqual(data.entries.map(item => item.name), ['灰烬议会']);
  assert.ok(data.entries[0].values.details.includes('\n'), '修复后的换行应保留在正文里');
  assert.equal(data.warnings.some(item => item.code === 'INVALID_JSON'), false);
});

test('解析：模型返回不可解析内容或空内容时，告警带段号与原文片段', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '这不是 JSON，只是一段说明。' } }] } }));
  const unparsable = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定文本。' } });
  assert.equal(unparsable.status, 200, unparsable.body);
  const broken = parse(unparsable);
  assert.equal(broken.entries.length, 0);
  const warning = broken.warnings.find(item => item.message.includes('模型原文片段'));
  assert.ok(warning, '段级告警必须带模型原文片段，否则作者无法诊断');
  assert.match(warning.message, /第 1 段/);
  assert.match(warning.message, /这不是 JSON/);
  assert.equal(broken.warnings.some(item => item.code === 'EMPTY_EXTRACTION'), true);

  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '' } }] } }));
  const empties = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '另一段设定文本。' } });
  // 每段都拿不到正文 = 全部段落失败，整体报错；错误里必须带响应形状，供作者判断是 key 错位、模型思考还是配置错。
  assert.equal(empties.status, 500, empties.body);
  const emptyError = String(parse(empties).error);
  assert.match(emptyError, /没有返回内容/);
  assert.match(emptyError, /返回字段=/);
  assert.match(emptyError, /style=/);
});

test('解析：默认关闭思考（thinking: disabled），避免思考把输出预算吃光', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '@@ 条目\n类型：info\n名称：灰烬议会\n正文：七名议员。\n' } }] } }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(fakeModel.requests[0].body.thinking, { type: 'disabled' }, '导入这类机械请求默认关闭思考');
  assert.deepEqual(parse(response).entries.map(item => item.name), ['灰烬议会']);
});

test('解析：供应商把正文放在 responses 形状里，chat 配置也能读到', async () => {
  fakeModel.reset();
  // 请求按 chat 发出（messages），响应却是 responses 形状（output[].content[]）——网关常见改写。
  fakeModel.setBehavior(() => ({
    status: 200,
    json: { output: [{ content: [{ type: 'text', text: '@@ 条目\n类型：info\n名称：灰烬议会\n正文：七名议员。\n' }] }] }
  }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.deepEqual(data.entries.map(item => item.name), ['灰烬议会']);
  assert.equal(fakeModel.requests.length, 1, '形状兼容应一次命中，不应触发风格回退');
});

test('解析：当前 API 类型返回空内容时自动换另一种形状重试并告警', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(body => {
    // 只认 Responses（有 instructions 且没有 messages），chat 形状一律空内容。
    if (!body.messages) return { status: 200, json: { output: [{ content: [{ type: 'output_text', text: '@@ 条目\n类型：info\n名称：灰烬议会\n正文：七名议员。\n' }] }] } };
    return { status: 200, json: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } };
  });
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.deepEqual(data.entries.map(item => item.name), ['灰烬议会']);
  assert.equal(fakeModel.requests.length, 2, '首段 chat 空内容 + responses 重试');
  assert.equal(data.normalization.style, 'responses');
  assert.equal(data.warnings.some(item => item.code === 'STYLE_FALLBACK'), true);
  assert.match(data.warnings.find(item => item.code === 'STYLE_FALLBACK').message, /API 类型/);
});

test('解析：responses 形状里 reasoning 项排在正文前时，不能把思考过程当条目', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({
    status: 200,
    json: {
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Let me organize this into entries. The source is a worldbuilding document…' }] },
        { type: 'message', content: [{ type: 'output_text', text: '@@ 条目\n类型：info\n名称：灰烬议会\n正文：七名议员。\n' }] }
      ]
    }
  }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.deepEqual(data.entries.map(item => item.name), ['灰烬议会']);
  assert.equal(JSON.stringify(data).includes('Let me organize'), false, '思考过程不得进入导入结果');
});

test('解析：只有 reasoning 项没有正文时，诊断说明「只返回了思考过程」', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({
    status: 200,
    json: { output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Let me organize this into entries…' }] }] }
  }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定文本。' } });
  assert.equal(response.status, 500, response.body);
  const error = String(parse(response).error);
  assert.match(error, /reasoning 项/);
  assert.match(error, /只返回了思考过程/);
});

test('解析：只有 reasoning_content 没有正文时，诊断指出这一点', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '', reasoning_content: '思考过程……'.repeat(20) }, finish_reason: 'length' }] } }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定文本。' } });
  assert.equal(response.status, 500, response.body);
  const error = String(parse(response).error);
  assert.match(error, /reasoning_content \d+ 字/);
  assert.match(error, /finish=length/);
});

test('解析：供应商拒绝 thinking 参数时自动去掉重试，并记住结论', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(body => {
    if (body.thinking) return { status: 400, json: { error: { message: 'Unrecognized request argument: thinking' } } };
    return { status: 200, json: { choices: [{ message: { content: '@@ 条目\n类型：info\n名称：灰烬议会\n正文：七名议员。\n' } }] } };
  });
  const first = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(first.status, 200, first.body);
  assert.deepEqual(parse(first).entries.map(item => item.name), ['灰烬议会']);
  assert.equal(fakeModel.requests.length, 2, '带 thinking 被 400 拒绝后去掉参数重试一次');
  assert.equal(fakeModel.requests[0].body.thinking.type, 'disabled');
  assert.equal(fakeModel.requests[1].body.thinking, undefined);

  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '@@ 条目\n类型：info\n名称：炉心\n正文：为城邦供能。\n' } }] } }));
  const second = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '炉心为城邦提供余热。' } });
  assert.equal(second.status, 200, second.body);
  assert.equal(fakeModel.requests.length, 1);
  assert.equal(fakeModel.requests[0].body.thinking, undefined, '进程内已记住不支持，后续不再发送');
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

test('解析：指定 intoWorld 时用它作为世界编号，并为条目分配不冲突的编号', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '@@ 条目\n类型：character\n名称：首席议员\n正文：主持议会。\n' } }] } }));
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '首席议员主持议会。', intoWorld: 'W01' } });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(data.mode, 'existing');
  assert.equal(data.worldId, 'W01');
  assert.deepEqual(data.entries.map(item => item.id), ['CHR-W01-002'], '必须避开已有的 CHR-W01-001');
  assert.equal(data.entries[0].worldId, 'W01');
});

test('解析：目标世界不存在时 400，且不调用模型', async () => {
  fakeModel.reset();
  const response = await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '一段设定文本。', intoWorld: 'W99' } });
  assert.equal(response.status, 400, response.body);
  assert.match(String(parse(response).error), /目标世界不存在/);
  assert.equal(fakeModel.requests.length, 0);
});

test('确认导入：并入已有世界只追加条目，不改世界条目、不新建世界', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '@@ 条目\n类型：character\n名称：首席议员\n正文：主持议会。\n' } }] } }));
  const parsed = parse(await request(server.port, '/api/lore-import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { text: '首席议员主持议会。', intoWorld: 'W01' } }));
  const before = parse(await request(server.port, '/api/content'));
  const response = await request(server.port, '/api/lore-import/commit', {
    method: 'POST', headers: importHeaders,
    body: { mode: 'existing', worldId: 'W01', plan: { worldId: parsed.worldId, world: parsed.world, entries: parsed.entries }, expectedRevision: before.revision }
  });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.equal(data.mode, 'existing');
  assert.equal(data.worldId, 'W01');
  assert.equal(data.world.id, 'W01');
  assert.equal(data.revision, before.revision + 1);

  const after = parse(await request(server.port, '/api/content'));
  const world = after.loreEntries.find(entry => entry.id === 'W01');
  assert.equal(world.name, '甲世界', '世界条目不得被导入内容覆盖');
  assert.equal(after.loreEntries.filter(entry => entry.type === 'world').length, before.loreEntries.filter(entry => entry.type === 'world').length, '不得新建世界条目');
  const imported = after.loreEntries.find(entry => entry.id === 'CHR-W01-002');
  assert.ok(imported, '条目应以目标世界的编号追加');
  assert.equal(imported.worldId, 'W01');
  assert.equal(imported.status, 'proposed');
});

test('确认导入：并入不存在的世界返回 400', async () => {
  const response = await request(server.port, '/api/lore-import/commit', {
    method: 'POST', headers: importHeaders,
    body: { mode: 'existing', worldId: 'W98', plan: { worldId: 'W98', world: { name: '幽灵世界' }, entries: [] } }
  });
  assert.equal(response.status, 400, response.body);
  assert.match(String(parse(response).error), /目标世界不存在/);
});

test('文件读取：缺标记头 403，DOCX 与压缩包被转成文本且不写库、不计模型调用', async () => {
  fakeModel.reset();
  const before = parse(await request(server.port, '/api/content'));

  const forbidden = await request(server.port, '/api/lore-import/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { files: [] } });
  assert.equal(forbidden.status, 403);

  const docx = docxBytes(['炉心余热维持着城邦的运转。', '议会由七名议员组成。']);
  const archive = zipBytes([{ name: '人物.md', data: '# 首席议员\n主持议会。' }]);
  const response = await request(server.port, '/api/lore-import/extract', {
    method: 'POST', headers: importHeaders,
    body: { files: [{ name: '设定主线.docx', dataBase64: docx.toString('base64') }, { name: '附件.zip', dataBase64: archive.toString('base64') }] }
  });
  assert.equal(response.status, 200, response.body);
  const data = parse(response);
  assert.match(data.text, /炉心余热维持着城邦的运转/);
  assert.match(data.text, /议会由七名议员组成/);
  assert.match(data.text, /首席议员/);
  assert.deepEqual(data.files.map(item => item.format), ['docx', 'zip']);
  assert.equal(data.warnings.length, 0);
  assert.equal(fakeModel.requests.length, 0, '文件读取不得调用模型');
  const after = parse(await request(server.port, '/api/content'));
  assert.equal(after.revision, before.revision, '文件读取不得写库');
});

test('文件读取：坏载荷与不支持的格式都有明确回应', async () => {
  const badBase64 = await request(server.port, '/api/lore-import/extract', { method: 'POST', headers: importHeaders, body: { files: [{ name: '坏.md', dataBase64: '不是 base64!!' }] } });
  assert.equal(badBase64.status, 400, badBase64.body);
  assert.match(String(parse(badBase64).error), /base64/);

  const empty = await request(server.port, '/api/lore-import/extract', { method: 'POST', headers: importHeaders, body: { files: [] } });
  assert.equal(empty.status, 400);

  const rar = await request(server.port, '/api/lore-import/extract', {
    method: 'POST', headers: importHeaders,
    body: { files: [{ name: '设定.rar', dataBase64: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 1, 2, 3]).toString('base64') }] }
  });
  assert.equal(rar.status, 200, rar.body);
  const data = parse(rar);
  assert.equal(data.text, '');
  assert.equal(data.warnings.some(item => item.code === 'RAR_UNSUPPORTED'), true);
});
