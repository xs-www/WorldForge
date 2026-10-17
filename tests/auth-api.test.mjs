import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before } from 'node:test';
import { hashPassword } from '../auth.mjs';

// 账号 API 的端到端契约：真实启动 server.mjs，用 users.json + REQUIRE_AUTH=1 走“公网部署”形态，
// 覆盖登录、会话、角色门禁、内容署名、配额与“没有账号库就拒绝启动”。

const repositoryRoot = new URL('../', import.meta.url);
const ADMIN_PASSWORD = 'admin-password-1';
const MEMBER_PASSWORD = 'alice-password-1';

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
    env: {
      ...process.env,
      PORT: String(port),
      LLM_API_KEY: '',
      SEEDREAM_API_KEY: '',
      WORLDFORGE_AUTH_USERS_PATH: join(dirname(env.WORLDFORGE_CONFIG_PATH), 'users.json'),
      ...env
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
  return { child, port, output: () => `${stdout}\n${stderr}`, close: () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); }) };
}

function sessionCookieOf(response) {
  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) return '';
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  return header.split(';')[0];
}

function parse(response) {
  try { return JSON.parse(response.body); } catch { return {}; }
}

let base, server;

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'worldforge-auth-api-'));
  const admin = await hashPassword(ADMIN_PASSWORD);
  const member = await hashPassword(MEMBER_PASSWORD);
  const secret = Buffer.from('test-session-secret-0123456789abcdef', 'utf8').toString('base64url');
  await writeFile(join(base, 'users.json'), `${JSON.stringify({
    version: 1,
    sessionSecret: secret,
    users: [
      { username: 'admin', role: 'admin', disabled: false, createdAt: '2026-10-18T00:00:00.000Z', createdBy: 'test', lastLoginAt: null, sessionVersion: 1, password: admin, quota: null },
      { username: 'alice', role: 'member', disabled: false, createdAt: '2026-10-18T00:00:00.000Z', createdBy: 'test', lastLoginAt: null, sessionVersion: 1, password: member, quota: { ai: 1, image: 0 } }
    ]
  }, null, 2)}\n`, 'utf8');
  server = await startServer({
    WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
    WORLDFORGE_REQUIRE_AUTH: '1',
    WORLDFORGE_COOKIE_SECURE: '0',
    WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
    WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
    WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
    WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
    WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
  });
});

after(async () => {
  if (server) await server.close();
  if (base) await rm(base, { recursive: true, force: true });
});

async function login(username, password) {
  const response = await request(server.port, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1' },
    body: { username, password }
  });
  return { response, body: parse(response), cookie: sessionCookieOf(response) };
}

test('健康检查与登录页公开，数据接口默认 401', async () => {
  const health = parse(await request(server.port, '/api/health'));
  assert.equal(health.status, 'ok');
  assert.equal(health.auth.mode, 'accounts');
  assert.equal(health.auth.users, 2);
  // 公开健康端点不得泄露绝对路径（/data、临时目录或 NAS 目录结构）。
  assert.equal(health.database.databasePath, undefined);
  assert.equal(health.simulation.databasePath, undefined);

  const content = await request(server.port, '/api/content');
  assert.equal(content.status, 401);
  assert.equal(parse(content).code, 'AUTH_REQUIRED');

  const settings = await request(server.port, '/api/settings');
  assert.equal(settings.status, 401);

  const index = await request(server.port, '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /id="loginForm"/, '匿名导航应拿到登录页');
  assert.doesNotMatch(index.body, /id="settingsDialog"/, '未登录不得拿到应用外壳');

  const loginJs = await request(server.port, '/login.js');
  assert.equal(loginJs.status, 200);
  const styles = await request(server.port, '/styles.css');
  assert.equal(styles.status, 200);

  const session = await request(server.port, '/api/auth/session');
  assert.equal(session.status, 200);
  assert.equal(parse(session).mode, 'accounts');
  assert.equal(parse(session).user, null);
});

test('登录需要请求标记，错误口令与未知账号返回同一个错误码', async () => {
  const missingMarker = await request(server.port, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { username: 'admin', password: ADMIN_PASSWORD } });
  assert.equal(missingMarker.status, 403);
  assert.equal(parse(missingMarker).code, 'AUTH_HEADER_REQUIRED');

  const wrong = await request(server.port, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1' }, body: { username: 'admin', password: 'wrong-password' } });
  assert.equal(wrong.status, 401);
  assert.equal(parse(wrong).code, 'AUTH_INVALID_CREDENTIALS');

  const unknown = await request(server.port, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1' }, body: { username: 'nobody', password: 'wrong-password' } });
  assert.equal(unknown.status, 401);
  assert.equal(parse(unknown).code, 'AUTH_INVALID_CREDENTIALS');
  assert.doesNotMatch(unknown.body, /nobody/, '错误响应不得回显用户名');
});

test('管理员会话可读设置与账号列表，登录后拿到应用外壳', async () => {
  const { response, body, cookie } = await login('admin', ADMIN_PASSWORD);
  assert.equal(response.status, 200);
  assert.equal(body.user.username, 'admin');
  assert.equal(body.user.role, 'admin');
  assert.ok(cookie);

  const index = await request(server.port, '/', { headers: { cookie } });
  assert.equal(index.status, 200);
  assert.match(index.body, /id="settingsDialog"/);

  const settings = await request(server.port, '/api/settings', { headers: { cookie } });
  assert.equal(settings.status, 200);
  assert.equal(parse(settings).configured, false);

  const users = await request(server.port, '/api/users', { headers: { cookie } });
  assert.equal(users.status, 200);
  const listed = parse(users).users.map(user => user.username).sort();
  assert.deepEqual(listed, ['admin', 'alice']);
  assert.deepEqual(parse(users).quotaDefaults, { ai: 200, image: 30 });

  const session = await request(server.port, '/api/auth/session', { headers: { cookie } });
  assert.equal(parse(session).user.username, 'admin');
  assert.deepEqual(parse(session).user.usage.ai, { used: 0, limit: null });
});

test('成员可写内容但不能读写设置与账号；保存会记录署名', async () => {
  const { cookie } = await login('alice', MEMBER_PASSWORD);

  const settings = await request(server.port, '/api/settings', { headers: { cookie } });
  assert.equal(settings.status, 403);
  assert.equal(parse(settings).code, 'AUTH_FORBIDDEN');

  const users = await request(server.port, '/api/users', { headers: { cookie } });
  assert.equal(users.status, 403);

  const content = await request(server.port, '/api/content', { headers: { cookie } });
  assert.equal(content.status, 200);

  const saved = await request(server.port, '/api/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Content': '1', cookie },
    body: { expectedRevision: parse(content).revision, loreEntries: [{ id: 'W01', name: '魔导工业世界', type: 'world' }], cardDrafts: [], keywords: [], notes: { 测试: '成员保存' } }
  });
  assert.equal(saved.status, 200, saved.body);
  assert.equal(parse(saved).lastSavedBy, 'alice');

  const reread = parse(await request(server.port, '/api/content', { headers: { cookie } }));
  assert.equal(reread.lastSavedBy, 'alice');
  assert.equal(reread.loreEntries[0].name, '魔导工业世界');
});

test('成员配额按账号计数，超限返回 429 且带限额信息', async () => {
  const { cookie } = await login('alice', MEMBER_PASSWORD);
  const first = await request(server.port, '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: { type: 'world', name: '测试世界' }
  });
  assert.equal(first.status, 500, '未配置模型时请求失败，但配额已被计入');

  const second = await request(server.port, '/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: { type: 'world', name: '测试世界' }
  });
  assert.equal(second.status, 429);
  const body = parse(second);
  assert.equal(body.code, 'AUTH_QUOTA_EXCEEDED');
  assert.equal(body.kind, 'ai');
  assert.equal(body.limit, 1);
  assert.equal(body.used, 1);
  assert.ok(body.resetAt);

  const session = parse(await request(server.port, '/api/auth/session', { headers: { cookie } }));
  assert.deepEqual(session.user.usage.ai, { used: 1, limit: 1 });
});

test('管理员可创建、调整、重置与删除账号，最后一个 admin 受保护', async () => {
  const { cookie } = await login('admin', ADMIN_PASSWORD);

  const created = await request(server.port, '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: { username: 'bob', role: 'member' }
  });
  assert.equal(created.status, 201, created.body);
  const generated = parse(created).password;
  assert.ok(generated.length >= 20);

  const bobLogin = await login('bob', generated);
  assert.equal(bobLogin.response.status, 200);
  assert.equal(bobLogin.body.user.quota.ai, 200);

  const patched = await request(server.port, '/api/users/bob', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: { quota: { ai: 3, image: 1 } }
  });
  assert.equal(patched.status, 200, patched.body);
  assert.deepEqual(parse(patched).user.quota, { ai: 3, image: 1 });

  const reset = await request(server.port, '/api/users/bob/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: {}
  });
  assert.equal(reset.status, 200, reset.body);
  const newPassword = parse(reset).password;
  assert.ok(newPassword);
  assert.equal((await login('bob', generated)).response.status, 401, '重置后旧口令失效');
  assert.equal((await login('bob', newPassword)).response.status, 200);

  const demote = await request(server.port, '/api/users/admin', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: { role: 'member' }
  });
  assert.equal(demote.status, 400);
  assert.equal(parse(demote).code, 'AUTH_LAST_ADMIN');

  const deleted = await request(server.port, '/api/users/bob', {
    method: 'DELETE',
    headers: { 'X-Worldforge-Auth': '1', cookie }
  });
  assert.equal(deleted.status, 200, deleted.body);
  assert.equal((await login('bob', newPassword)).response.status, 401);
});

test('退出登录会清掉 Cookie，旧令牌不再被浏览器携带', async () => {
  const { cookie } = await login('alice', MEMBER_PASSWORD);
  const logout = await request(server.port, '/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 200);
  const setCookie = logout.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.match(header, /Max-Age=0/);
});

test('自助改口令：需要旧口令，改完旧会话失效并换发新 Cookie', async () => {
  const { cookie } = await login('alice', MEMBER_PASSWORD);
  const wrong = await request(server.port, '/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: { currentPassword: 'not-the-password', newPassword: 'a-longer-new-password' }
  });
  assert.equal(wrong.status, 401);
  assert.equal(parse(wrong).code, 'AUTH_PASSWORD_MISMATCH');

  const changed = await request(server.port, '/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1', cookie },
    body: { currentPassword: MEMBER_PASSWORD, newPassword: 'a-longer-new-password' }
  });
  assert.equal(changed.status, 200, changed.body);
  const renewed = sessionCookieOf(changed);
  assert.ok(renewed);
  assert.equal((await request(server.port, '/api/content', { headers: { cookie } })).status, 401, '旧会话应失效');
  assert.equal((await request(server.port, '/api/content', { headers: { cookie: renewed } })).status, 200);
  assert.equal((await login('alice', MEMBER_PASSWORD)).response.status, 401);
  assert.equal((await login('alice', 'a-longer-new-password')).response.status, 200);
});

test('REQUIRE_AUTH=1 却没有 users.json 时拒绝启动并打印稳定错误码', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-auth-boot-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: {
      ...process.env,
      PORT: String(port),
      WORLDFORGE_CONFIG_PATH: join(directory, '.env.local'),
      WORLDFORGE_AUTH_USERS_PATH: join(directory, 'users.json'),
      WORLDFORGE_REQUIRE_AUTH: '1',
      WORLDFORGE_DB_PATH: join(directory, 'content.sqlite'),
      WORLDFORGE_SIM_DB_PATH: join(directory, 'simulation.sqlite')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(stderr, /AUTH_USERS_MISSING/);
  assert.match(stderr, /拒绝启动/);
});

test('未要求鉴权且没有 users.json 时保持匿名本机模式', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-auth-anon-'));
  const anonymous = await startServer({
    WORLDFORGE_CONFIG_PATH: join(directory, '.env.local'),
    WORLDFORGE_DB_PATH: join(directory, 'content.sqlite'),
    WORLDFORGE_SIM_DB_PATH: join(directory, 'simulation.sqlite'),
    WORLDFORGE_ASSETS_PATH: join(directory, 'assets'),
    WORLDFORGE_PROMPT_SETTINGS_PATH: join(directory, 'prompt-settings.json'),
    WORLDFORGE_COMFY_WORKFLOW_PATH: join(directory, 'comfyui-workflow.json')
  });
  try {
    const health = parse(await request(anonymous.port, '/api/health'));
    assert.equal(health.auth.mode, 'anonymous');
    assert.equal((await request(anonymous.port, '/api/content')).status, 200, '本机匿名模式下内容接口保持可用');
    const index = await request(anonymous.port, '/');
    assert.match(index.body, /id="settingsDialog"/, '匿名模式直接给应用外壳');
  } finally {
    await anonymous.close();
    await rm(directory, { recursive: true, force: true });
  }
});
