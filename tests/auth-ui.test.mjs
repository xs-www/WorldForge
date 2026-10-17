import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 账号界面的静态契约（ADR-0030）：登录页独立、会话决定可见性、401 回登录页、
// 设置里的「账号」面板覆盖创建/配额/停用/重置/删除。这些断言防止前端与 server.mjs 的门禁漂移。

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const loginHtml = await readFile(new URL('../dist/login.html', import.meta.url), 'utf8');
const loginJs = await readFile(new URL('../dist/login.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('登录页是独立页面，不加载应用外壳', () => {
  assert.match(loginHtml, /id="loginForm"/);
  assert.match(loginHtml, /id="loginUsername"/);
  assert.match(loginHtml, /id="loginPassword"/);
  assert.match(loginHtml, /<meta name="robots" content="noindex/);
  assert.match(loginHtml, /login\.js\?v=1/);
  assert.doesNotMatch(loginHtml, /app\.js/);
  assert.match(styleSource, /\.login-card\{/);
  assert.match(styleSource, /\.login-page\{/);
});

test('登录页用挂载相对路径请求登录并跳回应用根', () => {
  assert.match(loginJs, /new URL\('\.\/', document\.currentScript\.src\)/);
  assert.match(loginJs, /new URL\('\.\/api\/', document\.currentScript\.src\)/);
  assert.match(loginJs, /X-Worldforge-Auth/);
  assert.match(loginJs, /location\.replace\(SCRIPT_ROOT\.href\)/);
  assert.match(loginJs, /AUTH_INVALID_CREDENTIALS|stripCode/);
  assert.match(loginJs, /worldforge-preferences-v1/);
});

test('应用在 401 时回到登录页，并用会话决定界面可见性', () => {
  assert.match(appSource, /const LOGIN_URL=new URL\('\.\/login\.html',document\.currentScript\.src\)/);
  assert.match(appSource, /window\.fetch=async\(\.\.\.args\)=>/);
  assert.match(appSource, /if\(response\.status===401&&!String\(args\[0\]\|\|''\)\.includes\('\/api\/auth\/password'\)\)location\.replace\(LOGIN_URL\.href\)/);
  assert.match(appSource, /async function loadSession\(\)/);
  assert.match(appSource, /fetch\(apiUrl\('auth\/session'\)\)/);
  assert.match(appSource, /function isAdminSession\(\)/);
  assert.match(appSource, /q\('#openSettings'\)\.hidden=!admin/);
  assert.match(appSource, /q\('#logoutButton'\)\.hidden=!user/);
  assert.match(appSource, /q\('#changePasswordButton'\)\.hidden=!user/);
  assert.match(appSource, /if\(sessionMode==='accounts'&&!currentUser\)return/);
  assert.match(htmlSource, /id="currentUser"/);
  assert.match(htmlSource, /id="logoutButton"/);
  assert.match(htmlSource, /id="changePasswordButton"/);
});

test('设置里的账号面板覆盖创建、配额、停用、重置与删除', () => {
  assert.match(htmlSource, /data-settings-tab="users"/);
  assert.match(htmlSource, /data-settings-panel="users"/);
  for (const id of ['userList', 'userStatus', 'userSecret', 'newUserName', 'newUserRole', 'newUserPassword', 'createUser']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`), `缺少 #${id}`);
  }
  assert.match(appSource, /async function refreshUsers\(\)/);
  assert.match(appSource, /function userRow\(user\)/);
  assert.match(appSource, /async function patchUser\(name,patch\)/);
  assert.match(appSource, /async function createUserFromForm\(\)/);
  assert.match(appSource, /async function resetUserPassword\(name\)/);
  assert.match(appSource, /async function removeUser\(name\)/);
  assert.match(appSource, /apiUrl\('users\/'\+encodeURIComponent\(name\)\)/);
  assert.match(appSource, /quota:\{ai:numberOrNull\(quotaAi\.value\),image:numberOrNull\(quotaImage\.value\)\}/);
});

test('自助改口令与退出登录接线完整', () => {
  assert.match(htmlSource, /id="passwordDialog"/);
  assert.match(htmlSource, /id="currentPassword"/);
  assert.match(htmlSource, /id="newPassword"/);
  assert.match(htmlSource, /id="confirmPassword"/);
  assert.match(appSource, /async function savePasswordChange\(event\)/);
  assert.match(appSource, /fetch\(apiUrl\('auth\/password'\),\{method:'POST'/);
  assert.match(appSource, /q\('#logoutButton'\)\.onclick=/);
  assert.match(appSource, /fetch\(apiUrl\('auth\/logout'\),\{method:'POST'\}\)/);
});

test('保存内容的界面显示最后保存账号', () => {
  assert.match(appSource, /setStorageStatus\('SQLite 已保存'\+\(data\.lastSavedBy\?/);
  assert.match(appSource, /setStorageStatus\('SQLite 已连接'\+\(data\.lastSavedBy\?/);
});

test('服务端在路由分发之前执行鉴权，并保留健康检查与登录端点', () => {
  assert.match(serverSource, /const session = sessionOf\(req\);/);
  assert.match(serverSource, /if \(apiNeedsSession\(req\.method, pathname\) && !session\)/);
  assert.match(serverSource, /if \(apiNeedsAdmin\(req\.method, pathname\) && session\?\.role !== 'admin'\)/);
  assert.match(serverSource, /code: 'AUTH_REQUIRED'/);
  assert.match(serverSource, /code: 'AUTH_FORBIDDEN'/);
  assert.match(serverSource, /'GET \/api\/health', 'GET \/api\/auth\/session', 'POST \/api\/auth\/login', 'POST \/api\/auth\/logout'/);
  assert.match(serverSource, /\['x-worldforge-auth'\] !== '1'/);
  assert.match(serverSource, /await chargeQuota\('ai', session\)/);
  assert.match(serverSource, /await chargeQuota\('image', session\)/);
  assert.match(serverSource, /contentStore\.replace\(await readBody\(req\), \{ actor: session\?\.username \|\| 'anonymous' \}\)/);
});
