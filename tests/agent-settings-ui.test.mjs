import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Sprint 3 的界面契约：三个按 surface 过滤的选择器、当前 preset 标识、
// 切换确认，以及 preset 错误与模型错误的区分。静态断言，不做 DOM 渲染。

const repositoryRoot = new URL('../', import.meta.url);
const html = await readFile(new URL('dist/index.html', repositoryRoot), 'utf8');
const app = await readFile(new URL('dist/app.js', repositoryRoot), 'utf8');
const styles = await readFile(new URL('dist/styles.css', repositoryRoot), 'utf8');

test('the settings dialog offers one selector per surface', () => {
  assert.match(html, /data-settings-tab="agent">Agent 模式</);
  assert.match(html, /data-settings-panel="agent"/);
  for (const id of ['settingPresetLore', 'settingPresetFree', 'settingPresetCard']) {
    assert.match(html, new RegExp(`id="${id}"`), `缺少 ${id}`);
  }
  // 每个选择器都有独立说明，并通过 aria-describedby 关联到说明与错误区。
  for (const [id, help] of [['settingPresetLore', 'settingPresetLoreHelp'], ['settingPresetFree', 'settingPresetFreeHelp'], ['settingPresetCard', 'settingPresetCardHelp']]) {
    assert.match(html, new RegExp(`id="${id}" aria-describedby="[^"]*${help}[^"]*"`), `${id} 应关联 ${help}`);
    assert.match(html, new RegExp(`id="${help}"`));
  }
  assert.match(html, /id="settingPresetAgentError" role="alert"/);
  assert.match(html, /id="settingPresetStatus" role="status"/);
});

test('the settings page saves the three selections with the existing settings request', () => {
  assert.match(app, /agentPresets:\{lore:q\('#settingPresetLore'\)\.value,free:q\('#settingPresetFree'\)\.value,card:q\('#settingPresetCard'\)\.value\}/);
  // 选择器只显示该 surface 兼容的 preset。
  assert.match(app, /function fillPresetSelect\(select,surface,selectedId\)/);
  assert.match(app, /item\.surfaces\.includes\(surface\)/);
  // 打开设置时读取服务端默认值，并提示文件缺失/损坏的降级状态。
  assert.match(app, /agentSettingsSource==='missing'/);
  assert.match(app, /agentSettingsSource==='corrupt'/);
});

test('the free chat sends a preset snapshot and shows the current agent', () => {
  assert.match(html, /id="freePresetSelect"/);
  assert.match(html, /id="freePresetChip"/);
  assert.match(app, /presetId:freeConversationPreset\|\|agentSelections\.free\|\|undefined/);
  assert.match(app, /function syncFreePresetBar\(\)/);
  assert.match(app, /本轮 Agent：/);
  // 有历史时切换 preset 必须先确认，并在确认后开新对话。
  assert.match(app, /freeMessages\.length&&!window\.confirm\('切换 Agent preset 会开启新对话/);
  assert.match(app, /freeMessages=\[\];freeConversationPreset=next/);
});

test('the lore assistant sends its preset snapshot too', () => {
  assert.match(app, /presetId:agentSelections\.lore\|\|undefined/);
  assert.match(app, /data\.agent\?\.presetId/, '候选区应显示本轮实际 preset');
});

test('preset failures are distinguished from model failures in both entries', () => {
  assert.match(app, /function agentErrorIsPreset\(message\)/);
  assert.match(app, /AGENT_PROFILE_\|AGENT_SETTINGS_INVALID/);
  assert.match(app, /Agent preset 不可用：\$\{error\.message\}/, '自由对话的错误区分');
  assert.match(app, /Agent preset 不可用：\$\{e\.message\}/, '设定助手与设置页的错误区分');
  assert.match(styles, /\.settings-error\{/);
  assert.match(styles, /\.free-agent-bar\{/);
  assert.match(styles, /\.free-preset-chip\{/);
});
