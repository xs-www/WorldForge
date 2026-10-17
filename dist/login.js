// 登录页脚本（ADR-0030）。零构建、无依赖：
// - 用 document.currentScript 解析挂载路径，因此 Tailscale Funnel 的 `--set-path /worldforge` 不需要改任何 URL。
// - 只用相对路径请求 `<mount>/api/auth/login`，成功后跳回挂载根目录。
// - 已登录时直接跳回应用，避免重复登录。
const q = selector => document.querySelector(selector);
const SCRIPT_ROOT = new URL('./', document.currentScript.src);
const API_ROOT = new URL('./api/', document.currentScript.src);

function stripCode(message) {
  return String(message || '').replace(/^[A-Z][A-Z0-9_]*: /, '');
}

function showError(message) {
  const box = q('#loginError');
  box.textContent = message;
  box.hidden = false;
}

function clearError() {
  const box = q('#loginError');
  box.hidden = true;
  box.textContent = '';
}

function setBusy(busy) {
  q('#loginSubmit').disabled = busy;
  q('#loginUsername').disabled = busy;
  q('#loginPassword').disabled = busy;
  q('#loginSubmit').textContent = busy ? '正在登录…' : '登录';
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function redirectIfSignedIn() {
  try {
    const response = await fetch(new URL('auth/session', API_ROOT), { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const data = await readJson(response);
    if (data.user) location.replace(SCRIPT_ROOT.href);
  } catch { /* 离线时不阻塞登录表单 */ }
}

q('#togglePassword').addEventListener('click', () => {
  const input = q('#loginPassword');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  q('#togglePassword').textContent = show ? '隐藏口令' : '显示口令';
  q('#togglePassword').setAttribute('aria-pressed', String(show));
});

q('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearError();
  const username = q('#loginUsername').value.trim();
  const password = q('#loginPassword').value;
  if (!username || !password) { showError('请填写用户名与口令'); return; }
  setBusy(true);
  try {
    const response = await fetch(new URL('auth/login', API_ROOT), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worldforge-Auth': '1' },
      body: JSON.stringify({ username, password })
    });
    const data = await readJson(response);
    if (!response.ok) {
      const message = stripCode(data.error) || `登录失败（HTTP ${response.status}）`;
      showError(response.status === 429 ? `${message}，请稍后再试` : message);
      q('#loginPassword').value = '';
      q('#loginPassword').focus();
      return;
    }
    location.replace(SCRIPT_ROOT.href);
  } catch (error) {
    showError(`无法连接服务：${error.message}`);
  } finally {
    setBusy(false);
  }
});

// 主题与界面密度沿用浏览器里的编辑偏好，登录页与应用观感保持一致。
try {
  const preferences = JSON.parse(localStorage.getItem('worldforge-preferences-v1') || '{}');
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
  if (preferences.density) document.documentElement.dataset.density = preferences.density;
} catch { /* 偏好损坏不影响登录 */ }

redirectIfSignedIn();
q('#loginUsername').focus();
