// 账号与会话层（v0.3.0，ADR-0030）。
//
// 设计约束（与仓库其余部分一致）：
// - 零依赖：只用 `node:crypto`、`node:fs/promises`、`node:util`。
// - 单文件持久化：`users.json` 与 `.env.local`、`agent-settings.json` 同目录，原子写盘（tmp + rename，0600）。
// - 会话无状态：Cookie 里是 `v1.<payload>.<hmac>`，密钥来自 users.json 的 `sessionSecret`；
//   进程重启后会话仍有效，改密码/禁用/删除账号通过 `sessionVersion` 立即失效。
// - 账号模式只在存在 users.json 时启用；`WORLDFORGE_REQUIRE_AUTH=1` 时缺失或损坏直接拒绝启动，
//   避免“忘了建账号就把实例暴露到公网”。匿名模式是本机开发保留路径，不是公网部署路径。
// - 登录失败按「用户名」与「来源 IP」双维度限速；账号口令用 scrypt（N=16384,r=8,p=1,keylen=64）。
// - 配额按 UTC 自然日计数并落盘（`worldforge-usage.json`），避免重启清空计数。
// - 审计只追加 `worldforge-audit.jsonl`，记录账号与内容/settings 变更的 actor；不记录口令或令牌。

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const AUTH_USERS_ENV = 'WORLDFORGE_AUTH_USERS_PATH';
export const AUTH_REQUIRE_ENV = 'WORLDFORGE_REQUIRE_AUTH';
export const AUTH_COOKIE_SECURE_ENV = 'WORLDFORGE_COOKIE_SECURE';
export const AUTH_COOKIE_NAME = 'wf_session';
export const AUTH_FILE_VERSION = 1;
export const AUTH_ROLES = Object.freeze(['admin', 'member']);
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_DEFAULT_QUOTA = Object.freeze({ ai: 200, image: 30 });
export const AUTH_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const AUTH_PASSWORD_MIN_LENGTH = 10;
export const AUTH_PASSWORD_MAX_LENGTH = 200;
export const AUTH_MAX_USERS = 50;
export const AUTH_QUOTA_KINDS = Object.freeze(['ai', 'image']);

const SCRYPT_PARAMS = Object.freeze({ n: 16384, r: 8, p: 1, keylen: 64 });
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const USAGE_FILENAME = 'worldforge-usage.json';
const AUDIT_FILENAME = 'worldforge-audit.jsonl';

/** 稳定错误码 + HTTP 状态：调用方只按 code 判断，不解析文本。 */
export class AuthError extends Error {
  constructor(code, message, { status = 400, ...details } = {}) {
    super(`${code}: ${message}`);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new AuthError(code, message, options);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

export function validateUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!AUTH_USERNAME_PATTERN.test(username)) fail('AUTH_USERNAME_INVALID', '用户名只能用 2–32 位小写字母、数字、点、下划线或连字符，且以字母或数字开头');
  return username;
}

export function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < AUTH_PASSWORD_MIN_LENGTH) fail('AUTH_PASSWORD_WEAK', `口令至少 ${AUTH_PASSWORD_MIN_LENGTH} 位`);
  if (password.length > AUTH_PASSWORD_MAX_LENGTH) fail('AUTH_PASSWORD_WEAK', `口令不得超过 ${AUTH_PASSWORD_MAX_LENGTH} 位`);
  if (!password.trim()) fail('AUTH_PASSWORD_WEAK', '口令不能只有空白');
  return password;
}

/** 生成一次性初始口令：24 位 base64url（至少 32 位字符集熵），只在创建/重置时返回一次。 */
export function generatePassword() {
  return randomToken(18);
}

export function validateRole(value) {
  const role = String(value ?? '').trim();
  if (!AUTH_ROLES.includes(role)) fail('AUTH_ROLE_INVALID', `角色只能是 ${AUTH_ROLES.join(' / ')}`);
  return role;
}

export function normalizeQuota(value, fallback = AUTH_DEFAULT_QUOTA) {
  if (value === null) return null;
  if (value === undefined) return { ...fallback };
  if (!isPlainObject(value)) fail('AUTH_QUOTA_INVALID', '配额必须是对象或 null');
  const quota = {};
  for (const kind of AUTH_QUOTA_KINDS) {
    const raw = value[kind];
    if (raw === null) { quota[kind] = null; continue; }
    if (raw === undefined) { quota[kind] = fallback[kind]; continue; }
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100000) fail('AUTH_QUOTA_INVALID', `配额 ${kind} 必须是 0–100000 的整数或 null`);
    quota[kind] = limit;
  }
  return quota;
}

export async function hashPassword(password, params = SCRYPT_PARAMS) {
  const salt = randomBytes(16);
  const derived = await scrypt(validatePassword(password), salt, params.keylen, { N: params.n, r: params.r, p: params.p });
  return { salt: b64url(salt), hash: b64url(derived), n: params.n, r: params.r, p: params.p, keylen: params.keylen };
}

export async function verifyPassword(password, record) {
  if (!record || typeof record !== 'object') return false;
  const { salt, hash, n, r, p, keylen } = record;
  if (typeof salt !== 'string' || typeof hash !== 'string') return false;
  for (const number of [n, r, p, keylen]) if (!Number.isInteger(number) || number <= 0) return false;
  let derived;
  try {
    derived = await scrypt(String(password ?? ''), Buffer.from(salt, 'base64url'), keylen, { N: n, r, p });
  } catch { return false; }
  const expected = Buffer.from(hash, 'base64url');
  const actual = Buffer.from(derived);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** 会话令牌：`v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`。 */
export function signSession({ username, version, expiresAt, secret }) {
  const payload = b64url(JSON.stringify({ u: username, v: version, e: expiresAt }));
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(`v1.${payload}`).digest();
  return `v1.${payload}.${b64url(signature)}`;
}

export function verifySession(token, { secret, now = () => Date.now() } = {}) {
  if (typeof token !== 'string' || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadText, signatureText] = parts;
  const expected = createHmac('sha256', Buffer.from(String(secret ?? ''), 'base64url')).update(`v1.${payloadText}`).digest();
  let actual;
  try { actual = Buffer.from(signatureText, 'base64url'); } catch { return null; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8')); } catch { return null; }
  if (!isPlainObject(payload) || typeof payload.u !== 'string' || !Number.isInteger(payload.v) || !Number.isInteger(payload.e)) return null;
  if (payload.e <= now()) return null;
  return payload;
}

/** 从 `Cookie` 头里取会话令牌；重复或畸形时返回 null，不抛错。 */
export function readSessionCookie(header) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    const value = part.slice(index + 1).trim();
    return value || null;
  }
  return null;
}

export function sessionCookie(token, { secure = false, maxAgeSeconds = Math.floor(AUTH_SESSION_TTL_MS / 1000) } = {}) {
  const attributes = [`${AUTH_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const attributes = [`${AUTH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** 只有显式的 `1`/`0` 生效；未设置返回 null，由调用方按请求协议自动判断。 */
export function cookieSecureMode(value = process.env[AUTH_COOKIE_SECURE_ENV]) {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export function isSecureRequest(req) {
  const forwarded = req?.headers?.['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.split(',')[0].trim() === 'https') return true;
  return Boolean(req?.socket?.encrypted);
}

function validatePasswordRecord(record, username) {
  if (!isPlainObject(record)) fail('AUTH_USERS_INVALID', `${username} 缺少 password 记录`);
  const { salt, hash, n, r, p, keylen } = record;
  if (typeof salt !== 'string' || !salt || typeof hash !== 'string' || !hash) fail('AUTH_USERS_INVALID', `${username} 的口令记录不完整`);
  for (const [name, number] of Object.entries({ n, r, p, keylen })) {
    if (!Number.isInteger(number) || number <= 0) fail('AUTH_USERS_INVALID', `${username} 的口令参数 ${name} 非法`);
  }
  return { salt, hash, n, r, p, keylen };
}

/** 校验 users.json 结构；返回规范化副本，未知字段一律丢弃（不把任意内容写回磁盘）。 */
export function validateAuthFile(value) {
  if (!isPlainObject(value)) fail('AUTH_USERS_INVALID', 'users.json 必须是 JSON 对象');
  if (value.version !== AUTH_FILE_VERSION) fail('AUTH_USERS_INVALID', `users.json 版本必须是 ${AUTH_FILE_VERSION}`);
  if (typeof value.sessionSecret !== 'string' || Buffer.from(value.sessionSecret, 'base64url').length < 32) fail('AUTH_USERS_INVALID', 'users.json 缺少有效的 sessionSecret（至少 32 字节）');
  if (!Array.isArray(value.users) || value.users.length > AUTH_MAX_USERS) fail('AUTH_USERS_INVALID', `users 必须是数组且不超过 ${AUTH_MAX_USERS} 项`);
  const seen = new Set();
  const users = value.users.map(entry => {
    if (!isPlainObject(entry)) fail('AUTH_USERS_INVALID', 'users 中存在非对象条目');
    const username = String(entry.username ?? '');
    if (!AUTH_USERNAME_PATTERN.test(username)) fail('AUTH_USERS_INVALID', `用户名非法：${username || '(空)'}`);
    if (seen.has(username)) fail('AUTH_USERS_INVALID', `用户名重复：${username}`);
    seen.add(username);
    const role = String(entry.role ?? '');
    if (!AUTH_ROLES.includes(role)) fail('AUTH_USERS_INVALID', `${username} 的角色非法：${role || '(空)'}`);
    const sessionVersion = entry.sessionVersion === undefined ? 1 : entry.sessionVersion;
    if (!Number.isInteger(sessionVersion) || sessionVersion < 1) fail('AUTH_USERS_INVALID', `${username} 的 sessionVersion 非法`);
    return {
      username,
      role,
      disabled: entry.disabled === true,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      createdBy: typeof entry.createdBy === 'string' ? entry.createdBy : '',
      lastLoginAt: typeof entry.lastLoginAt === 'string' ? entry.lastLoginAt : null,
      sessionVersion,
      password: validatePasswordRecord(entry.password, username),
      quota: entry.quota === null ? null : normalizeQuota(entry.quota)
    };
  });
  if (!users.some(user => user.role === 'admin')) fail('AUTH_USERS_INVALID', '至少要有一个 admin 账号');
  return { version: AUTH_FILE_VERSION, sessionSecret: value.sessionSecret, users };
}

async function readJsonFile(path, label) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') fail('AUTH_USERS_MISSING', `${label} 不存在：${path}`, { status: 500, path });
    fail('AUTH_USERS_INVALID', `${label} 无法读取：${error.message}`, { status: 500 });
  }
  try { return JSON.parse(raw); }
  catch (error) { fail('AUTH_USERS_INVALID', `${label} 不是合法 JSON：${error.message}`, { status: 500 }); }
}

async function writeFileAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function todayKey(now) {
  return new Date(now()).toISOString().slice(0, 10);
}

function publicUser(user, usage) {
  return {
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
    createdBy: user.createdBy,
    lastLoginAt: user.lastLoginAt,
    quota: user.quota,
    usage
  };
}

/**
 * 打开账号库并返回服务对象。
 * @param {{usersPath: string, now?: () => number, quotaDefaults?: {ai:number,image:number}, requireAuth?: boolean}} options
 */
export async function openAuthStore({ usersPath, now = () => Date.now(), quotaDefaults = AUTH_DEFAULT_QUOTA, requireAuth = false } = {}) {
  if (!usersPath) throw new Error('openAuthStore 需要 usersPath');
  const state = validateAuthFile(await readJsonFile(usersPath, 'users.json'));
  let mtimeMs = await stat(usersPath).then(info => info.mtimeMs).catch(() => 0);
  const usagePath = join(dirname(usersPath), USAGE_FILENAME);
  const auditPath = join(dirname(usersPath), AUDIT_FILENAME);
  let usageCache = await readFile(usagePath, 'utf8').then(text => JSON.parse(text)).catch(() => ({}));
  if (!isPlainObject(usageCache)) usageCache = {};
  const loginFailures = new Map();

  function userNamed(username) {
    return state.users.find(user => user.username === username) || null;
  }

  function usageBucket(username) {
    const day = todayKey(now);
    const dayUsage = isPlainObject(usageCache[day]) ? usageCache[day] : (usageCache[day] = {});
    const bucket = isPlainObject(dayUsage[username]) ? dayUsage[username] : { ai: 0, image: 0 };
    for (const kind of AUTH_QUOTA_KINDS) if (!Number.isInteger(bucket[kind]) || bucket[kind] < 0) bucket[kind] = 0;
    dayUsage[username] = bucket;
    return bucket;
  }

  async function saveUsage() {
    // 只保留最近 7 天，避免无限增长。
    const days = Object.keys(usageCache).sort();
    for (const day of days.slice(0, Math.max(0, days.length - 7))) delete usageCache[day];
    await writeFileAtomic(usagePath, `${JSON.stringify(usageCache, null, 2)}\n`);
  }

  async function saveState() {
    const payload = { version: AUTH_FILE_VERSION, sessionSecret: state.sessionSecret, users: state.users };
    await writeFileAtomic(usersPath, `${JSON.stringify(payload, null, 2)}\n`);
    mtimeMs = await stat(usersPath).then(info => info.mtimeMs).catch(() => 0);
  }

  /** CLI 在服务运行期间改文件时，登录/管理操作前按 mtime 重载；重载失败保留旧状态并记录。 */
  async function reloadIfStale() {
    const current = await stat(usersPath).then(info => info.mtimeMs).catch(() => mtimeMs);
    if (current === mtimeMs) return;
    try {
      const next = validateAuthFile(await readJsonFile(usersPath, 'users.json'));
      state.users = next.users;
      state.sessionSecret = next.sessionSecret;
      mtimeMs = current;
    } catch (error) {
      console.warn(`[auth] users.json 已变化但无法重载，继续使用内存副本：${error.message}`);
    }
  }

  async function audit({ actor = 'system', action, detail = {} } = {}) {
    if (!action) return;
    const line = JSON.stringify({ at: new Date(now()).toISOString(), actor, action, detail });
    try {
      await mkdir(dirname(auditPath), { recursive: true });
      await appendFile(auditPath, `${line}\n`, { mode: 0o600 });
    } catch (error) { console.warn(`[auth] 审计写入失败（${action}）：${error.message}`); }
  }

  function sessionFor(user, { secure }) {
    const token = signSession({ username: user.username, version: user.sessionVersion, expiresAt: now() + AUTH_SESSION_TTL_MS, secret: state.sessionSecret });
    return { token, expiresAt: new Date(now() + AUTH_SESSION_TTL_MS).toISOString(), cookie: sessionCookie(token, { secure }) };
  }

  function assertUnlocked(key) {
    const entry = loginFailures.get(key);
    if (!entry || !entry.lockedUntil) return;
    if (entry.lockedUntil > now()) {
      fail('AUTH_RATE_LIMITED', '尝试次数过多，请稍后再试', { status: 429, retryAfterSeconds: Math.ceil((entry.lockedUntil - now()) / 1000) });
    }
    loginFailures.delete(key);
  }

  function noteFailure(key, { max, windowMs, lockMs }) {
    const entry = loginFailures.get(key) || { count: 0, firstAt: now(), lockedUntil: 0 };
    if (now() - entry.firstAt > windowMs) { entry.count = 0; entry.firstAt = now(); }
    entry.count += 1;
    if (entry.count >= max) entry.lockedUntil = now() + lockMs;
    loginFailures.set(key, entry);
  }

  function quarantine(key) {
    const entry = loginFailures.get(key);
    return Boolean(entry?.lockedUntil && entry.lockedUntil > now());
  }

  async function login({ username, password, ip = '', secure = false } = {}) {
    await reloadIfStale();
    const name = String(username ?? '').trim().toLowerCase();
    const userKey = `user:${name || '(empty)'}`;
    const ipKey = `ip:${ip || 'unknown'}`;
    assertUnlocked(userKey);
    assertUnlocked(ipKey);
    const user = userNamed(name);
    // 未知用户也做一次等价耗时的校验，避免用响应时间枚举账号。
    const passwordRecord = user?.password || (await dummyPasswordRecord());
    const passwordOk = await verifyPassword(password, passwordRecord);
    if (!user || user.disabled || !passwordOk) {
      noteFailure(userKey, { max: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS, lockMs: LOGIN_LOCK_MS });
      noteFailure(ipKey, { max: IP_MAX_FAILURES, windowMs: IP_WINDOW_MS, lockMs: LOGIN_LOCK_MS });
      await audit({ actor: name || '(empty)', action: 'auth.login.failed', detail: { ip } });
      if (quarantine(userKey) || quarantine(ipKey)) fail('AUTH_RATE_LIMITED', '尝试次数过多，请稍后再试', { status: 429, retryAfterSeconds: Math.ceil(LOGIN_LOCK_MS / 1000) });
      fail('AUTH_INVALID_CREDENTIALS', '用户名或口令不正确', { status: 401 });
    }
    loginFailures.delete(userKey);
    loginFailures.delete(ipKey);
    user.lastLoginAt = new Date(now()).toISOString();
    await saveState();
    const session = sessionFor(user, { secure });
    await audit({ actor: user.username, action: 'auth.login', detail: { ip } });
    return { user: publicUser(user, usageFor(user)), ...session };
  }

  let dummyRecord = null;
  async function dummyPasswordRecord() {
    if (!dummyRecord) dummyRecord = await hashPassword(generatePassword());
    return dummyRecord;
  }

  function usageFor(user) {
    const bucket = usageBucket(user.username);
    const quota = user.quota;
    return {
      ai: { used: bucket.ai, limit: quota ? quota.ai : null },
      image: { used: bucket.image, limit: quota ? quota.image : null }
    };
  }

  function sessionFromRequest(req) {
    const token = readSessionCookie(req?.headers?.cookie);
    if (!token) return null;
    const payload = verifySession(token, { secret: state.sessionSecret, now });
    if (!payload) return null;
    const user = userNamed(payload.u);
    if (!user || user.disabled || user.sessionVersion !== payload.v) return null;
    return { username: user.username, role: user.role, exp: payload.e };
  }

  async function consumeQuota({ username, kind }) {
    if (!AUTH_QUOTA_KINDS.includes(kind)) throw new Error(`未知配额类型：${kind}`);
    const user = userNamed(username);
    if (!user) fail('AUTH_USER_MISSING', '账号不存在', { status: 404 });
    const quota = user.quota;
    if (quota === null) return { allowed: true, unlimited: true };
    const bucket = usageBucket(username);
    const limit = quota ? quota[kind] : null;
    if (limit === null) return { allowed: true, unlimited: true };
    if (bucket[kind] + 1 > limit) {
      await audit({ actor: username, action: 'quota.exceeded', detail: { kind, limit } });
      fail('AUTH_QUOTA_EXCEEDED', `今日 ${kind === 'image' ? '生图' : 'AI 调用'}配额已用完（${limit} 次）`, {
        status: 429,
        kind,
        limit,
        used: bucket[kind],
        resetAt: new Date(new Date(now()).setUTCHours(24, 0, 0, 0)).toISOString()
      });
    }
    bucket[kind] += 1;
    await saveUsage();
    return { allowed: true, used: bucket[kind], limit };
  }

  function listUsers() {
    return state.users.map(user => publicUser(user, usageFor(user)));
  }

  function requireAdminCount() {
    return state.users.filter(user => user.role === 'admin' && !user.disabled).length;
  }

  async function createUser({ username, password, role = 'member', quota, actor = 'cli' } = {}) {
    await reloadIfStale();
    const name = validateUsername(username);
    const selectedRole = validateRole(role);
    if (userNamed(name)) fail('AUTH_USER_EXISTS', `账号已存在：${name}`, { status: 409 });
    if (state.users.length >= AUTH_MAX_USERS) fail('AUTH_USER_LIMIT', `账号数量上限为 ${AUTH_MAX_USERS}`, { status: 409 });
    const initialPassword = password ? validatePassword(password) : generatePassword();
    const record = {
      username: name,
      role: selectedRole,
      disabled: false,
      createdAt: new Date(now()).toISOString(),
      createdBy: actor,
      lastLoginAt: null,
      sessionVersion: 1,
      password: await hashPassword(initialPassword),
      quota: selectedRole === 'admin' ? (quota === undefined ? null : normalizeQuota(quota)) : normalizeQuota(quota, quotaDefaults)
    };
    state.users.push(record);
    await saveState();
    await audit({ actor, action: 'user.create', detail: { username: name, role: selectedRole } });
    return { user: publicUser(record, usageFor(record)), password: password ? null : initialPassword };
  }

  async function updateUser({ username, patch = {}, actor = 'admin' } = {}) {
    await reloadIfStale();
    const name = String(username ?? '');
    const user = userNamed(name);
    if (!user) fail('AUTH_USER_MISSING', `账号不存在：${name}`, { status: 404 });
    const next = { ...user };
    if (patch.role !== undefined) next.role = validateRole(patch.role);
    if (patch.disabled !== undefined) next.disabled = patch.disabled === true;
    if (patch.quota !== undefined) next.quota = normalizeQuota(patch.quota, quotaDefaults);
    if ((user.role === 'admin' && !user.disabled) && (next.role !== 'admin' || next.disabled) && requireAdminCount() <= 1) {
      fail('AUTH_LAST_ADMIN', '至少要保留一个可用的 admin 账号');
    }
    if (next.role !== user.role || next.disabled !== user.disabled) next.sessionVersion = user.sessionVersion + 1;
    Object.assign(user, next);
    await saveState();
    await audit({ actor, action: 'user.update', detail: { username: name, role: user.role, disabled: user.disabled } });
    return { user: publicUser(user, usageFor(user)) };
  }

  async function resetPassword({ username, password, actor = 'admin' } = {}) {
    await reloadIfStale();
    const user = userNamed(String(username ?? ''));
    if (!user) fail('AUTH_USER_MISSING', `账号不存在：${username}`, { status: 404 });
    const nextPassword = password ? validatePassword(password) : generatePassword();
    user.password = await hashPassword(nextPassword);
    user.sessionVersion += 1;
    await saveState();
    await audit({ actor, action: 'user.password.reset', detail: { username: user.username } });
    return { user: publicUser(user, usageFor(user)), password: password ? null : nextPassword };
  }

  async function changePassword({ username, currentPassword, newPassword } = {}) {
    await reloadIfStale();
    const user = userNamed(String(username ?? ''));
    if (!user) fail('AUTH_USER_MISSING', '账号不存在', { status: 404 });
    if (!(await verifyPassword(currentPassword, user.password))) fail('AUTH_PASSWORD_MISMATCH', '当前口令不正确', { status: 401 });
    user.password = await hashPassword(validatePassword(newPassword));
    user.sessionVersion += 1;
    await saveState();
    await audit({ actor: user.username, action: 'auth.password.change', detail: {} });
    return { user: publicUser(user, usageFor(user)) };
  }

  async function deleteUser({ username, actor = 'admin' } = {}) {
    await reloadIfStale();
    const name = String(username ?? '');
    const index = state.users.findIndex(user => user.username === name);
    if (index < 0) fail('AUTH_USER_MISSING', `账号不存在：${name}`, { status: 404 });
    if (name === actor) fail('AUTH_SELF_TARGET', '不能删除当前登录的账号');
    if (state.users[index].role === 'admin' && state.users[index].disabled === false && requireAdminCount() <= 1) fail('AUTH_LAST_ADMIN', '至少要保留一个可用的 admin 账号');
    state.users.splice(index, 1);
    await saveState();
    await audit({ actor, action: 'user.delete', detail: { username: name } });
    return { ok: true };
  }

  async function issueSession(username) {
    await reloadIfStale();
    const user = userNamed(String(username ?? ''));
    if (!user || user.disabled) fail('AUTH_USER_MISSING', '账号不存在或已停用', { status: 404 });
    return sessionFor(user, { secure: false });
  }

  return {
    mode: 'accounts',
    usersPath,
    requireAuth,
    sessionFromRequest,
    login,
    logout: async ({ username } = {}) => { await audit({ actor: username, action: 'auth.logout', detail: {} }); },
    sessionFor: issueSession,
    changePassword,
    listUsers,
    createUser,
    updateUser,
    resetPassword,
    deleteUser,
    usageFor: username => {
      const user = userNamed(String(username ?? ''));
      return user ? usageFor(user) : null;
    },
    consumeQuota,
    audit,
    userCount: () => state.users.length,
    health: () => ({ mode: 'accounts', users: state.users.length, requireAuth })
  };
}
