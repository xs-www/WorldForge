#!/usr/bin/env node
// 账号运维 CLI（ADR-0030）。
//
// 用它在 NAS / 容器里创建首个管理员、加人、重置口令与调整配额。
// 默认路径与服务端一致：`WORLDFORGE_AUTH_USERS_PATH`；未设置时取 `.env.local` 所在目录的
// `users.json`，因此 `node scripts/auth-cli.mjs add alice --admin` 与 `npm start` 操作同一份账号库。
//
// 用法：
//   node scripts/auth-cli.mjs add <username> [--admin] [--password <口令>]
//   node scripts/auth-cli.mjs list
//   node scripts/auth-cli.mjs reset <username> [--password <口令>]
//   node scripts/auth-cli.mjs role <username> <admin|member>
//   node scripts/auth-cli.mjs quota <username> <ai|image> <次数|unlimited>
//   node scripts/auth-cli.mjs enable|disable <username>
//   node scripts/auth-cli.mjs remove <username>
//   node scripts/auth-cli.mjs bootstrap <username>        （等价于 add <username> --admin）
// 全局选项：--users <path> 覆盖账号库路径。
//
// 注意：`add`/`reset`/`bootstrap` 未提供 --password 时会生成一次性口令并打印；
// 口令只在这一行出现，不会写进 users.json 明文。

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_DEFAULT_QUOTA,
  AUTH_FILE_VERSION,
  AUTH_USERS_ENV,
  generatePassword,
  hashPassword,
  openAuthStore,
  validatePassword,
  validateRole,
  validateUsername
} from '../auth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const configPath = process.env.WORLDFORGE_CONFIG_PATH || join(root, '.env.local');
const defaultUsersPath = process.env[AUTH_USERS_ENV] || join(dirname(configPath), 'users.json');

function parseArgs(argv) {
  const options = { command: '', positional: [], password: '', usersPath: defaultUsersPath, admin: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--admin') options.admin = true;
    else if (arg === '--password') options.password = argv[++index] || '';
    else if (arg === '--users') options.usersPath = argv[++index] || '';
    else rest.push(arg);
  }
  options.command = rest.shift() || '';
  options.positional = rest;
  return options;
}

async function writeNewStore(usersPath, { username, password, role }) {
  const name = validateUsername(username);
  const secret = randomBytes(32).toString('base64url');
  const record = {
    username: name,
    role: validateRole(role),
    disabled: false,
    createdAt: new Date().toISOString(),
    createdBy: 'cli',
    lastLoginAt: null,
    sessionVersion: 1,
    password: await hashPassword(validatePassword(password)),
    quota: role === 'admin' ? null : { ...AUTH_DEFAULT_QUOTA }
  };
  const payload = { version: AUTH_FILE_VERSION, sessionSecret: secret, users: [record] };
  await mkdir(dirname(usersPath), { recursive: true });
  const temporary = `${usersPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, usersPath);
  return record;
}

async function openOrBootstrap(usersPath) {
  try {
    return { store: await openAuthStore({ usersPath }), created: false };
  } catch (error) {
    if (error.code === 'AUTH_USERS_MISSING') return { store: null, created: false };
    throw error;
  }
}

function printUsers(store) {
  const users = store.listUsers();
  if (!users.length) { console.log('（没有账号）'); return; }
  console.log('用户名\t角色\t状态\t配额(ai/image)\t今日用量(ai/image)\t最后登录');
  for (const user of users) {
    const quota = user.quota ? `${user.quota.ai ?? '∞'}/${user.quota.image ?? '∞'}` : '不限';
    const usage = `${user.usage.ai.used}/${user.usage.ai.limit ?? '∞'} · ${user.usage.image.used}/${user.usage.image.limit ?? '∞'}`;
    console.log(`${user.username}\t${user.role}\t${user.disabled ? '停用' : '启用'}\t${quota}\t${usage}\t${user.lastLoginAt || '从未'}`);
  }
}

function announcePassword(username, password) {
  console.log(`账号 ${username} 的一次性口令：${password}`);
  console.log('请让使用者首次登录后立即在「设置 → 账号」里改掉它；口令不会再次显示。');
}

function fail(error) {
  console.error(`[auth-cli] ${error.code || 'ERROR'}: ${error.message}`);
  process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { command, positional } = options;
  if (!command || command === 'help' || command === '--help') {
    console.log('用法：node scripts/auth-cli.mjs <add|bootstrap|list|reset|role|quota|enable|disable|remove> [参数] [--users <path>]');
    console.log('账号库：', options.usersPath);
    return;
  }
  if (!options.usersPath) { console.error('[auth-cli] 账号库路径为空：请设置 --users 或 WORLDFORGE_AUTH_USERS_PATH'); process.exitCode = 1; return; }

  const { store } = await openOrBootstrap(options.usersPath);

  if (command === 'list') {
    if (!store) { console.log(`账号库不存在：${options.usersPath}`); return; }
    printUsers(store);
    return;
  }

  if (command === 'add' || command === 'bootstrap') {
    const username = positional[0];
    if (!username) throw new Error('缺少用户名');
    const role = command === 'bootstrap' || options.admin ? 'admin' : 'member';
    if (!store) {
      if (role !== 'admin') throw Object.assign(new Error('账号库不存在：首个账号必须是管理员（加 --admin 或用 bootstrap）'), { code: 'AUTH_FIRST_USER' });
      const password = options.password || generatePassword();
      await writeNewStore(options.usersPath, { username, password, role: 'admin' });
      console.log(`已创建账号库：${options.usersPath}`);
      announcePassword(username, password);
      return;
    }
    const result = await store.createUser({ username, role, password: options.password || undefined, actor: 'cli' });
    if (result.password) announcePassword(result.user.username, result.password);
    else console.log(`已创建账号 ${result.user.username}（${result.user.role}），口令为你提供的值。`);
    return;
  }

  if (!store) { console.error(`[auth-cli] 账号库不存在：${options.usersPath}；先运行 add <username> --admin`); process.exitCode = 1; return; }

  const username = positional[0];
  if (!username) throw new Error('缺少用户名');

  if (command === 'reset') {
    const result = await store.resetPassword({ username, password: options.password || undefined, actor: 'cli' });
    if (result.password) announcePassword(result.user.username, result.password);
    else console.log(`已重置 ${result.user.username} 的口令为你提供的值；其现有登录立即失效。`);
    return;
  }

  if (command === 'role') {
    const role = positional[1];
    const result = await store.updateUser({ username, patch: { role }, actor: 'cli' });
    console.log(`${result.user.username} 的角色已改为 ${result.user.role}。`);
    return;
  }

  if (command === 'quota') {
    const kind = positional[1];
    if (!['ai', 'image'].includes(kind)) throw new Error('配额类型必须是 ai 或 image');
    const raw = positional[2];
    const limit = raw === 'unlimited' ? null : Number(raw);
    const current = store.listUsers().find(user => user.username === String(username).toLowerCase());
    if (!current) throw Object.assign(new Error(`账号不存在：${username}`), { code: 'AUTH_USER_MISSING' });
    const quota = { ...(current.quota || { ai: null, image: null }), [kind]: limit };
    await store.updateUser({ username, patch: { quota }, actor: 'cli' });
    console.log(`${current.username} 的 ${kind} 每日配额已设为 ${limit === null ? '不限' : limit}。`);
    return;
  }

  if (command === 'enable' || command === 'disable') {
    const result = await store.updateUser({ username, patch: { disabled: command === 'disable' }, actor: 'cli' });
    console.log(`${result.user.username} 已${result.user.disabled ? '停用' : '启用'}。`);
    return;
  }

  if (command === 'remove') {
    await store.deleteUser({ username, actor: 'cli' });
    console.log(`已删除账号 ${username}。`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

try {
  await main();
} catch (error) {
  fail(error);
}
