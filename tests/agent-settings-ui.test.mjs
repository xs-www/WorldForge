import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Sprint 3 的界面契约。这里刻意解析**最终事件绑定**再检查处理器正文，
// 因为此前出现过「旧实现含 agentPresets 但被后面的重新绑定覆盖」的回归。

const repositoryRoot = new URL('../', import.meta.url);
const html = await readFile(new URL('dist/index.html', repositoryRoot), 'utf8');
const app = await readFile(new URL('dist/app.js', repositoryRoot), 'utf8');
const styles = await readFile(new URL('dist/styles.css', repositoryRoot), 'utf8');

/** 取某个元素最后一次被绑定的处理器名。 */
function lastBoundHandler(source, selector) {
  const pattern = new RegExp(`q\\('${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)\\.onclick=([A-Za-z_$][\\w$]*)`, 'g');
  const names = [...source.matchAll(pattern)].map(match => match[1]);
  return names.at(-1) ?? null;
}

/** 取函数定义正文（到下一个顶层 function 定义为止）。 */
function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  const startSync = start >= 0 ? start : source.indexOf(`function ${name}(`);
  if (startSync < 0) return '';
  const nextAsync = source.indexOf('\nasync function ', startSync + 10);
  const nextSync = source.indexOf('\nfunction ', startSync + 10);
  const candidates = [nextAsync, nextSync].filter(index => index > 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(startSync, end);
}

test('the settings dialog offers one selector per surface with accessible descriptions', () => {
  assert.match(html, /data-settings-tab="agent">Agent 模式</);
  assert.match(html, /data-settings-panel="agent"/);
  for (const [id, help] of [['settingPresetLore', 'settingPresetLoreHelp'], ['settingPresetFree', 'settingPresetFreeHelp'], ['settingPresetCard', 'settingPresetCardHelp']]) {
    assert.match(html, new RegExp(`id="${id}" aria-describedby="[^"]*${help}[^"]*"`), `缺少 ${id} 或它的 aria-describedby`);
    assert.match(html, new RegExp(`id="${help}"`), `缺少说明 ${help}`);
  }
  assert.match(html, /id="settingPresetAgentError" role="alert"/);
  assert.match(html, /id="settingPresetStatus" role="status"/);
});

test('the actually bound save handler submits the three selections', () => {
  const handler = lastBoundHandler(app, '#saveSettings');
  assert.ok(handler, '找不到 #saveSettings 的绑定');
  const body = functionBody(app, handler);
  assert.ok(body.length > 0, `绑定到的 ${handler} 没有函数定义`);
  assert.ok(body.includes('agentPresets:agentSettingsPatchFromForm()'), `最终绑定的 ${handler} 必须提交 agentPresets`);
  assert.ok(body.includes('applyAgentSettingsAfterSave('), `最终绑定的 ${handler} 必须在成功后同步选择状态`);
  assert.ok(body.includes('showAgentSaveError('), `最终绑定的 ${handler} 必须在失败时显示 preset 错误`);
  // 不允许存在同名旧实现被覆盖：所有绑定名都必须有且只有一个定义。
  assert.equal(app.split('async function saveSettings(event){').length, 1, '不应残留被覆盖的 saveSettings 旧实现');
});

test('opening settings loads the catalog first and syncs the free-chat selector', () => {
  const handler = lastBoundHandler(app, '#openSettings');
  assert.ok(handler, '找不到 #openSettings 的绑定');
  const body = functionBody(app, handler);
  assert.match(body, /await openSettings\(\)/, '模式设置入口应先执行通用设置加载');
  const base = functionBody(app, 'openSettings');
  assert.ok(base.includes('await refreshAgentCatalog()'), '打开设置时必须加载 preset 目录');
  assert.ok(base.includes('syncFreePresetBar()'), '打开设置后必须同步自由对话的选择器');
  assert.ok(base.includes('agentPanelStatusText()'), '状态行应显示当前三项选择');
});

test('bootstrap loads the preset catalog before reading the saved selection', () => {
  const boot = functionBody(app, 'bootstrap');
  const catalog = boot.indexOf('refreshAgentCatalog()');
  const settings = boot.indexOf('refreshAgentSettings()');
  assert.ok(catalog >= 0 && settings > catalog, '必须先加载目录再读取保存值，否则选择器会因空目录被禁用');
});

test('a saved preset that is no longer available is shown as unavailable, not silently swapped', () => {
  const fill = functionBody(app, 'fillPresetSelect');
  assert.ok(fill.includes('（已不可用）'), '失效的已保存 preset 必须显式列出');
  assert.ok(fill.includes('option.value=selectedId'), '失效项必须保持选中的原 id，而不是选中第一个兼容项');
  const sync = functionBody(app, 'syncFreePresetBar');
  assert.ok(sync.includes('（已不可用）'), '自由对话 chip 也要用文字说明失效');
  const patch = functionBody(app, 'agentSettingsPatchFromForm');
  assert.ok(patch.includes('agentSelectionIsValid('), '保存时只提交有效的选择，避免失效项阻塞其他设置');
});

test('the free chat sends a preset snapshot, freezes it after the first reply, and shows the current agent', () => {
  assert.match(html, /id="freePresetSelect"/);
  assert.match(html, /id="freePresetChip"/);
  const send = functionBody(app, 'sendFreeMessage');
  assert.ok(send.includes('presetId:freeConversationPreset||agentSelections.free||undefined'), '请求必须携带 preset 快照');
  assert.ok(send.includes('freeConversationPreset=data.agent.presetId'), '首次响应后必须冻结本次对话的 preset');
  const chooser = functionBody(app, 'chooseFreePreset');
  assert.match(chooser, /freeMessages\.length&&!window\.confirm\('切换 Agent preset 会开启新对话/, '有历史时切换必须先确认');
  assert.match(chooser, /freeMessages=\[\];freeConversationPreset=next/, '确认后清空对话并冻结新 preset');
  const meta = functionBody(app, 'freeAgentMeta');
  assert.ok(meta.includes('message.agent?.presetId'), '每轮气泡应显示该轮实际 preset');
});

test('the lore assistant sends its preset snapshot and shows it', () => {
  const run = functionBody(app, 'runAi');
  assert.ok(run.includes('presetId:agentSelections.lore||undefined'), '设定助手请求必须携带镜照');
  assert.ok(run.includes('agentErrorIsPreset('), '设定助手必须区分 preset 错误');
  assert.ok(functionBody(app, 'renderAiVariants').includes('data.agent?.presetId'), '候选区应显示本轮实际 preset');
});

test('the card agent panel covers the five actions, field selection and apply/save-as-draft', () => {
  assert.match(html, /id="cardAgentPanel"/);
  assert.match(html, /id="runCardAgent"/);
  for (const value of ['brainstorm', 'polish', 'rules_review', 'balance_review', 'lore_alignment']) {
    assert.match(html, new RegExp(`id="cardAgentAction"[\\s\\S]*?value="${value}"`), `缺少操作 ${value}`);
  }
  assert.match(app, /function runCardAgent\(\)/);
  assert.ok(functionBody(app, 'runCardAgent').includes("apiUrl('ai/card')"), '卡牌 Agent 必须请求 /api/ai/card');
  assert.ok(functionBody(app, 'cardAgentPayload').includes('presetId:agentSelections.card'), '请求必须携带卡牌入口的 preset 快照');
  assert.ok(functionBody(app, 'cardAgentPayload').includes('selectedFields'), '必须只提交勾选的字段');
  // 回填不保存，独立草案才保存，且固定 proposed / untested。
  assert.ok(functionBody(app, 'applyCardAgentVariant').includes('未保存'));
  const draft = functionBody(app, 'saveCardAgentDraft');
  assert.ok(draft.includes('activeCardId=null'), '独立草案必须新建 id');
  assert.ok(draft.includes('proposed / untested'));
  assert.match(styles, /\.card-agent-variant\{/);
  // 接口不支持 json_schema 时的降级必须在界面上可见，而不是静默降级。
  assert.ok(functionBody(app, 'renderCardAgentResults').includes('fallbackReason'), '降级原因必须显示给作者');
});

test('preset failures are distinguished from model failures and styled as text', () => {
  const helper = functionBody(app, 'agentErrorIsPreset');
  assert.ok(helper.includes('AGENT_PROFILE_') && helper.includes('AGENT_SETTINGS_INVALID'));
  assert.ok(functionBody(app, 'showAgentSaveError').includes('Agent preset 不可用：'));
  assert.match(styles, /\.settings-error\{/);
  assert.match(styles, /\.free-agent-bar\{/);
  assert.match(styles, /\.free-preset-chip\{/);
});
