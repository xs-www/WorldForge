#!/usr/bin/env node
/**
 * 容器运行期冒烟检查（CI 与手工排查共用）。
 *
 * `Dockerfile` 用显式白名单 `COPY` 服务端模块：漏登记一个模块时镜像仍然能构建成功，
 * 但容器会在启动阶段抛 `ERR_MODULE_NOT_FOUND`；Agent preset 投影漏拷则会触发
 * Registry 的完整性门并以 `[agent-profiles] ...` 拒绝启动。因此“构建成功”不等于
 * “可运行”，本脚本对已启动的真实容器做 HTTP 断言，而不是只检查构建产物。
 *
 * 用法：`node scripts/ci/smoke-container.mjs [baseUrl]`
 * 环境变量：`SMOKE_BASE_URL`（默认 `http://127.0.0.1:4173`）、`SMOKE_TIMEOUT_MS`（默认 90000）
 * 退出码：`0` 全部通过；`1` 存在失败项或健康检查等待超时。
 *
 * 断言不调用任何模型或生图服务：CI 没有密钥，也不应该产生付费请求。
 */

const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);

// 随仓库发布的三个 preset（README 与 ADR-0029 §9 的完整性门要求三个入口都能解析）。
const EXPECTED_PRESETS = ['card-designer', 'free-creator', 'lore-writer'];
// 三个产品入口；`defaults` 必须指向已发布的投影，否则 Registry 拒绝启动。
const EXPECTED_SURFACES = ['lore', 'free', 'card'];
// 浏览器可见投影不得泄露提示词正文、仓库路径或内部策略字段。
const FORBIDDEN_LEAKS = ['systemPrompt', 'runtime/system.md', '.agent-presets', 'agent.cordis.yml', 'skills/', 'toolPolicy'];

const results = [];
let failed = 0;

function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function request(pathname, accept = 'application/json, text/html;q=0.9') {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { accept } });
  return { status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text() };
}

async function requestJson(pathname) {
  const response = await request(pathname);
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error(`${pathname} 未返回 JSON（HTTP ${response.status}）：${response.body.slice(0, 200)}`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`${pathname} 返回 HTTP ${response.status}：${JSON.stringify(parsed).slice(0, 200)}`);
  return parsed;
}

/** 轮询直到健康端点返回 JSON；容器冷启动需要跑完 SQLite 迁移与 preset 加载。 */
async function waitForHealth() {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error('尚未发起请求');
  while (Date.now() < deadline) {
    try {
      return await requestJson('/api/health');
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`等待 ${baseUrl}/api/health 超时（${timeoutMs}ms）：${lastError.message}`);
}

async function main() {
  console.log(`冒烟目标：${baseUrl}`);
  const health = await waitForHealth();

  record(health.status === 'ok', '/api/health 返回 status=ok', String(health.status));
  // quick_check 通过说明 SQLite 已打开、迁移完成且 /data 挂载可写（--read-only 根文件系统下的关键验证）。
  record(health.database?.ok === true, 'SQLite 完整性检查通过（/data 可写、迁移完成）', `schemaVersion=${health.database?.schemaVersion}`);
  record(Array.isArray(health.database?.migration?.applied) && typeof health.database?.migration?.currentVersion === 'number', '健康信息带本次启动的迁移记录', JSON.stringify(health.database?.migration ?? null).slice(0, 120));

  const profiles = health.agentProfiles ?? {};
  record(profiles.count === 3, '三个 Agent preset 全部加载', `count=${profiles.count}`);
  record((profiles.diagnostics ?? []).length === 0, 'preset 无诊断项', JSON.stringify(profiles.diagnostics ?? []));
  record(EXPECTED_PRESETS.every(id => (profiles.ids ?? []).includes(id)), 'preset ID 与仓库发布清单一致', JSON.stringify(profiles.ids ?? []));
  record(profiles.countBySurface && EXPECTED_SURFACES.every(surface => Number(profiles.countBySurface[surface]) >= 1), '每个入口都至少有一个可用 preset', JSON.stringify(profiles.countBySurface ?? null));

  const view = await requestJson('/api/ai/presets');
  record((view.presets ?? []).length === 3, '/api/ai/presets 返回三份脱敏投影', `count=${(view.presets ?? []).length}`);
  record(EXPECTED_SURFACES.every(surface => (view.presets ?? []).some(preset => preset.id === view.defaults?.[surface])), '三个入口的默认 preset 都能解析到已发布投影', JSON.stringify(view.defaults ?? null));
  const serialized = JSON.stringify(view);
  const leaked = FORBIDDEN_LEAKS.filter(term => serialized.includes(term));
  record(leaked.length === 0, '浏览器投影不泄露提示词正文、仓库路径与内部策略', leaked.length ? `命中：${leaked.join(', ')}` : '');
  // 指纹格式冻结为 `sha256:<64 位十六进制>`：镜像若混入不同版本的投影，哈希会与仓库对不上。
  const hashPattern = /^sha256:[0-9a-f]{64}$/;
  record(view.presets?.length === 3 && view.presets.every(preset => hashPattern.test(preset.hash ?? '')), '每个投影都带确定性的 SHA-256 指纹', `${view.presets?.[0]?.hash?.slice(0, 20)}…`);

  const index = await request('/');
  record(index.status === 200 && /text\/html/i.test(index.contentType) && index.body.includes('Worldforge'), '静态界面可从镜像内正确提供', `HTTP ${index.status} ${index.contentType}`);

  const content = await requestJson('/api/content');
  record(typeof content.revision === 'number' && typeof content.initialized === 'boolean', '/api/content 可读写（SQLite 内容库已就绪）', `revision=${content.revision}, initialized=${content.initialized}`);

  const simulation = await requestJson('/api/simulation');
  record(simulation.instance && typeof simulation.instance.currentTick === 'number', '/api/simulation 可用（独立模拟存档已就绪）', `tick=${simulation.instance?.currentTick}`);

  const summary = results.filter(item => item.ok).length;
  console.log(`\n冒烟结果：${summary}/${results.length} 通过，${failed} 失败`);
  if (failed) {
    for (const item of results.filter(entry => !entry.ok)) console.log(`  失败：${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`冒烟失败：${error.message}`);
  if (failed) {
    for (const item of results.filter(entry => !entry.ok)) console.error(`  失败：${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  }
  process.exitCode = 1;
});
