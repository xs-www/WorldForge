import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTH_COOKIE_NAME,
  AUTH_DEFAULT_QUOTA,
  AuthError,
  clearSessionCookie,
  generatePassword,
  hashPassword,
  normalizeQuota,
  openAuthStore,
  readSessionCookie,
  sessionCookie,
  signSession,
  validateAuthFile,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifySession
} from '../auth.mjs';

// 账号与会话层只依赖 node:crypto 与文件系统；这些用例全部在临时目录里跑，
// 不触碰仓库数据，也不发起网络请求。

const SECRET = randomBytes(32).toString('base64url');

function passwordRecord(password = 'correct-horse-battery') {
  return hashPassword(password);
}

async function seedUsers({ users = [], secret = SECRET } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wf-auth-'));
  const usersPath = join(directory, 'users.json');
  const seeded = users.length ? users : [{
    username: 'admin',
    role: 'admin',
    disabled: false,
    createdAt: '2026-10-18T00:00:00.000Z',
    createdBy: 'test',
    lastLoginAt: null,
    sessionVersion: 1,
    password: await passwordRecord('admin-password-1'),
    quota: null
  }];
  await writeFile(usersPath, `${JSON.stringify({ version: 1, sessionSecret: secret, users: seeded }, null, 2)}\n`, 'utf8');
  return { directory, usersPath };
}

function memberRecord({ username = 'alice', password = 'alice-password-1', quota = { ai: 2, image: 1 } } = {}) {
  return { username, role: 'member', disabled: false, createdAt: '2026-10-18T00:00:00.000Z', createdBy: 'test', lastLoginAt: null, sessionVersion: 1, password: null, passwordPlain: password, quota };
}

async function storeWithMember() {
  const member = memberRecord();
  member.password = await passwordRecord(member.passwordPlain);
  delete member.passwordPlain;
  const seeded = await seedUsers({ users: [await adminRecord(), member] });
  const store = await openAuthStore({ usersPath: seeded.usersPath });
  return { ...seeded, store };
}

async function adminRecord() {
  return {
    username: 'admin',
    role: 'admin',
    disabled: false,
    createdAt: '2026-10-18T00:00:00.000Z',
    createdBy: 'test',
    lastLoginAt: null,
    sessionVersion: 1,
    password: await passwordRecord('admin-password-1'),
    quota: null
  };
}

test('scrypt 口令可以往返校验，错误口令与弱口令都不通过', async () => {
  const record = await passwordRecord('a-long-enough-password');
  assert.equal(await verifyPassword('a-long-enough-password', record), true);
  assert.equal(await verifyPassword('a-long-enough-passwore', record), false);
  assert.equal(await verifyPassword('', record), false);
  assert.equal(await verifyPassword('whatever', null), false);
  await assert.rejects(() => hashPassword('short'), error => error instanceof AuthError && error.code === 'AUTH_PASSWORD_WEAK');
  assert.throws(() => validatePassword('   '), /AUTH_PASSWORD_WEAK/);
  assert.equal(validatePassword('0123456789'), '0123456789');
});

test('用户名与角色只接受规范形态', () => {
  // 用户名大小写不敏感：创建与登录都归一为小写，因此 'Alice' 视为 'alice'。
  assert.equal(validateUsername('  Alice '), 'alice');
  for (const bad of ['a', 'a b', '-alice', 'alice@example.com', 'x'.repeat(33), '']) {
    assert.throws(() => validateUsername(bad), /AUTH_USERNAME_INVALID/, `${bad} 应被拒绝`);
  }
  assert.equal(generatePassword().length >= 20, true);
});

test('配额只接受 0–100000 的整数或 null', () => {
  assert.deepEqual(normalizeQuota({ ai: 5, image: 2 }), { ai: 5, image: 2 });
  assert.deepEqual(normalizeQuota(undefined), { ...AUTH_DEFAULT_QUOTA });
  assert.equal(normalizeQuota(null), null);
  assert.deepEqual(normalizeQuota({ ai: null }), { ai: null, image: AUTH_DEFAULT_QUOTA.image });
  for (const bad of [{ ai: -1 }, { ai: 1.5 }, { ai: 'many' }, 'unlimited']) {
    assert.throws(() => normalizeQuota(bad), /AUTH_QUOTA_INVALID/, JSON.stringify(bad));
  }
});

test('users.json 结构校验拒绝坏版本、坏密钥与重复账号', async () => {
  const password = await passwordRecord('admin-password-1');
  const admin = { username: 'admin', role: 'admin', createdAt: '2026-10-18T00:00:00.000Z', sessionVersion: 1, password, quota: null };
  const valid = validateAuthFile({ version: 1, sessionSecret: SECRET, users: [admin] });
  assert.equal(valid.users[0].username, 'admin');

  assert.throws(() => validateAuthFile({ version: 2, sessionSecret: SECRET, users: [admin] }), /AUTH_USERS_INVALID/);
  assert.throws(() => validateAuthFile({ version: 1, sessionSecret: 'short', users: [admin] }), /sessionSecret/);
  assert.throws(() => validateAuthFile({ version: 1, sessionSecret: SECRET, users: [admin, { ...admin }] }), /用户名重复/);
  assert.throws(() => validateAuthFile({ version: 1, sessionSecret: SECRET, users: [{ ...admin, role: 'member' }] }), /至少要有一个 admin/);
  assert.throws(() => validateAuthFile({ version: 1, sessionSecret: SECRET, users: [{ ...admin, role: 'owner' }] }), /角色非法/);
  assert.throws(() => validateAuthFile({ version: 1, sessionSecret: SECRET, users: [{ ...admin, password: null }] }), /password 记录/);
});

test('会话令牌可见可验，篡改与过期都失效', () => {
  const expiresAt = Date.now() + 60_000;
  const token = signSession({ username: 'alice', version: 3, expiresAt, secret: SECRET });
  const payload = verifySession(token, { secret: SECRET });
  assert.equal(payload.u, 'alice');
  assert.equal(payload.v, 3);
  assert.equal(verifySession(token, { secret: SECRET, now: () => expiresAt + 1 }), null);
  assert.equal(verifySession(`${token}x`, { secret: SECRET }), null);
  assert.equal(verifySession(token, { secret: randomBytes(32).toString('base64url') }), null);
  assert.equal(verifySession('v1.not-base64.sig', { secret: SECRET }), null);
  assert.equal(verifySession('', { secret: SECRET }), null);
});

test('Cookie 头解析与 Set-Cookie 属性符合 HttpOnly / SameSite / Secure 约定', () => {
  assert.equal(readSessionCookie(`${AUTH_COOKIE_NAME}=token-a; other=1`), 'token-a');
  assert.equal(readSessionCookie(`x=1; ${AUTH_COOKIE_NAME}=token-b`), 'token-b');
  assert.equal(readSessionCookie('x=1'), null);
  assert.equal(readSessionCookie(undefined), null);
  const header = sessionCookie('token', { secure: true });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=2592000/);
  assert.doesNotMatch(sessionCookie('token', { secure: false }), /Secure/);
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/);
});

test('登录成功返回会话令牌，失败计数到上限后返回 429', async () => {
  const { usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const session = await store.login({ username: 'admin', password: 'admin-password-1', ip: '203.0.113.9' });
  assert.equal(session.user.role, 'admin');
  assert.ok(session.token);
  const request = { headers: { cookie: sessionCookie(session.token) } };
  assert.equal(store.sessionFromRequest(request)?.username, 'admin');
  assert.equal(store.sessionFromRequest({ headers: { cookie: 'wf_session=bogus' } }), null);

  const failureStore = await openAuthStore({ usersPath });
  // 前 4 次是普通失败；第 5 次即触发锁定期，正确口令也会被 429 拒绝。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(() => failureStore.login({ username: 'admin', password: 'wrong-password', ip: '198.51.100.7' }), error => error.code === 'AUTH_INVALID_CREDENTIALS');
  }
  await assert.rejects(
    () => failureStore.login({ username: 'admin', password: 'wrong-password', ip: '198.51.100.7' }),
    error => error.code === 'AUTH_RATE_LIMITED' && error.status === 429 && error.details.retryAfterSeconds > 0
  );
  await assert.rejects(
    () => failureStore.login({ username: 'admin', password: 'admin-password-1', ip: '198.51.100.7' }),
    error => error.code === 'AUTH_RATE_LIMITED'
  );
});

test('未知用户与错误口令返回同一个错误码，不泄露账号是否存在', async () => {
  const { usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const errors = [];
  for (const [username, password] of [['nobody', 'whatever-password'], ['admin', 'wrong-password']]) {
    try { await store.login({ username, password, ip: '203.0.113.10' }); } catch (error) { errors.push(error); }
  }
  assert.deepEqual(errors.map(error => error.code), ['AUTH_INVALID_CREDENTIALS', 'AUTH_INVALID_CREDENTIALS']);
});

test('创建、重置、禁用与删除账号会推进 sessionVersion 并保护最后一个 admin', async () => {
  const { usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const created = await store.createUser({ username: 'bob', role: 'member', actor: 'admin' });
  assert.ok(created.password.length >= 20, '生成的一次性口令应当足够长');
  const login = await store.login({ username: 'bob', password: created.password, ip: '203.0.113.11' });
  assert.equal(login.user.role, 'member');

  await store.updateUser({ username: 'bob', patch: { disabled: true }, actor: 'admin' });
  assert.equal(store.sessionFromRequest({ headers: { cookie: sessionCookie(login.token) } }), null, '禁用后旧会话立即失效');
  await assert.rejects(() => store.login({ username: 'bob', password: created.password, ip: '203.0.113.11' }), error => error.code === 'AUTH_INVALID_CREDENTIALS');

  await store.updateUser({ username: 'bob', patch: { disabled: false }, actor: 'admin' });
  const reset = await store.resetPassword({ username: 'bob', actor: 'admin' });
  assert.ok(reset.password);
  await assert.rejects(() => store.login({ username: 'bob', password: created.password, ip: '203.0.113.11' }), error => error.code === 'AUTH_INVALID_CREDENTIALS');
  assert.ok((await store.login({ username: 'bob', password: reset.password, ip: '203.0.113.11' })).token);

  await assert.rejects(() => store.updateUser({ username: 'admin', patch: { role: 'member' }, actor: 'admin' }), error => error.code === 'AUTH_LAST_ADMIN');
  await assert.rejects(() => store.deleteUser({ username: 'admin', actor: 'admin' }), error => error.code === 'AUTH_SELF_TARGET');
  await assert.rejects(() => store.deleteUser({ username: 'missing', actor: 'admin' }), error => error.code === 'AUTH_USER_MISSING');
});

test('改口令需要旧口令，成功后旧会话失效', async () => {
  const { usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const session = await store.login({ username: 'admin', password: 'admin-password-1', ip: '203.0.113.12' });
  await assert.rejects(() => store.changePassword({ username: 'admin', currentPassword: 'nope-nope-nope', newPassword: 'a-new-long-password' }), error => error.code === 'AUTH_PASSWORD_MISMATCH');
  await store.changePassword({ username: 'admin', currentPassword: 'admin-password-1', newPassword: 'a-new-long-password' });
  assert.equal(store.sessionFromRequest({ headers: { cookie: sessionCookie(session.token) } }), null);
  const fresh = await store.sessionFor('admin');
  assert.ok(fresh.token);
  assert.ok(await store.login({ username: 'admin', password: 'a-new-long-password', ip: '203.0.113.12' }));
});

test('配额按 UTC 日计数、落盘并在重启后保留', async () => {
  const { directory, usersPath } = await storeWithMember();
  const store = await openAuthStore({ usersPath });
  const member = store.listUsers().find(user => user.username === 'alice');
  assert.deepEqual(member.quota, { ai: 2, image: 1 });
  assert.deepEqual(store.usageFor('alice'), { ai: { used: 0, limit: 2 }, image: { used: 0, limit: 1 } });

  await store.consumeQuota({ username: 'alice', kind: 'ai' });
  await store.consumeQuota({ username: 'alice', kind: 'ai' });
  await assert.rejects(() => store.consumeQuota({ username: 'alice', kind: 'ai' }), error => error.code === 'AUTH_QUOTA_EXCEEDED' && error.status === 429 && error.details.kind === 'ai');
  assert.deepEqual(store.usageFor('alice').ai, { used: 2, limit: 2 });

  const reopened = await openAuthStore({ usersPath });
  assert.deepEqual(reopened.usageFor('alice').ai, { used: 2, limit: 2 });
  assert.ok((await readFile(join(directory, 'worldforge-usage.json'), 'utf8')).includes('alice'));

  // admin 默认不限量
  assert.deepEqual(await reopened.consumeQuota({ username: 'admin', kind: 'image' }), { allowed: true, unlimited: true });
});

test('运行期被 CLI 改写的 users.json 在下次登录时生效', async () => {
  const { usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const password = generatePassword();
  const record = await passwordRecord(password);
  const current = JSON.parse(await readFile(usersPath, 'utf8'));
  current.users.push({ username: 'carol', role: 'member', disabled: false, createdAt: new Date().toISOString(), createdBy: 'cli', lastLoginAt: null, sessionVersion: 1, password: record, quota: { ai: 10, image: 2 } });
  await new Promise(resolve => setTimeout(resolve, 20));
  await writeFile(usersPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  const session = await store.login({ username: 'carol', password, ip: '203.0.113.13' });
  assert.equal(session.user.username, 'carol');
  assert.equal(session.user.quota.ai, 10);
});

test('审计日志只记录动作与 actor，不包含口令或令牌', async () => {
  const { directory, usersPath } = await seedUsers();
  const store = await openAuthStore({ usersPath });
  const session = await store.login({ username: 'admin', password: 'admin-password-1', ip: '203.0.113.14' });
  await store.createUser({ username: 'dave', role: 'member', actor: 'admin' });
  const auditText = await readFile(join(directory, 'worldforge-audit.jsonl'), 'utf8');
  assert.match(auditText, /auth\.login/);
  assert.match(auditText, /user\.create/);
  assert.doesNotMatch(auditText, new RegExp(session.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(auditText, /admin-password-1/);
});
