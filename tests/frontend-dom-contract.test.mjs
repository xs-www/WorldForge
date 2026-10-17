import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// app.js 在**加载时**就给固定元素绑定 handler（`q('#saveCard').onclick = …`）。
// 只要 HTML 里少了任何一个被引用的 id，脚本会在加载阶段抛 TypeError，
// 整个界面停在一张静态页上——这类回归在无浏览器的测试里很容易漏掉，所以在源码层断言。
const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

test('app.js 引用的每个元素 id 都存在于 index.html', () => {
  const referenced = new Set([...appSource.matchAll(/q\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]));
  const present = new Set([...htmlSource.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(match => match[1]));
  assert.ok(referenced.size > 250, `应该解析出足够多的元素引用，实际 ${referenced.size}`);
  const missing = [...referenced].filter(id => !present.has(id)).sort();
  assert.deepEqual(missing, [], `index.html 缺少这些元素：${missing.join(', ')}`);
});

test('资料组脚本在 app.js 之前加载，且 index.html 不再写死资料类型标签页', () => {
  const scripts = [...htmlSource.matchAll(/<script src="\.\/([^"?]+)\?v=\d+"><\/script>/g)].map(match => match[1]);
  assert.ok(scripts.includes('lore-groups.js'), 'index.html 必须加载 lore-groups.js');
  assert.ok(scripts.indexOf('lore-groups.js') < scripts.indexOf('app.js'), 'lore-groups.js 必须先于 app.js');
  // 固定资料组由 WorldforgeLoreGroups 渲染，HTML 里不应再出现写死的 data-lore-type 按钮。
  assert.match(htmlSource, /<div class="lore-tabs" id="loreTabs" role="tablist" aria-label="资料组"><\/div>/);
  assert.doesNotMatch(htmlSource, /data-lore-type="magic"/);
  assert.doesNotMatch(htmlSource, /data-lore-type="faction"/);
});

test('前端不再内置默认世界，也不再附带题材化的种子数据', () => {
  assert.doesNotMatch(appSource, /W01_SEED/);
  assert.doesNotMatch(appSource, /魔导工业/);
  assert.doesNotMatch(appSource, /蒸汽机械/);
  assert.doesNotMatch(htmlSource, /魔导工业/);
  assert.doesNotMatch(htmlSource, /以太二字/);
  // 世界编号只能由 nextWorldId 分配，不能被写死成兜底值。
  assert.doesNotMatch(appSource, /\|\|'W01'/);
  assert.doesNotMatch(appSource, /worldId:'W01'/);
});

test('数据管理面板提供导出、预检与导入入口', () => {
  for (const id of ['settingsExport', 'settingsExportImages', 'importFile', 'importMode', 'importPreview', 'importApply', 'importStatus']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`), `数据面板缺少 #${id}`);
  }
  assert.match(appSource, /async function exportServerData\(includeImages\)/);
  assert.match(appSource, /async function previewImport\(\)/);
  assert.match(appSource, /async function applyImport\(\)/);
  assert.match(appSource, /X-Worldforge-Import/);
});

test('资料组管理入口与编辑对话框接线完整', () => {
  for (const id of ['newLoreGroup', 'manageLoreGroup', 'groupDialog', 'groupPickRow', 'groupPickList', 'newGroupFromList', 'groupFormBody', 'groupBackRow', 'groupBack', 'groupLabel', 'groupScopeRow', 'manageSharedGroups', 'sharedGroupStatus', 'loreDetails', 'groupFormType', 'groupScope', 'groupPrompt', 'groupFieldRows', 'addGroupField', 'restoreGroupFields', 'groupSchemaPreview', 'groupStatus', 'saveLoreGroup', 'deleteLoreGroup']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`), `缺少 #${id}`);
  }
  for (const name of ['renderLoreTabs', 'openLoreGroupDialog', 'saveLoreGroupFromDialog', 'deleteLoreGroupFromDialog', 'fillLoreGroupDialog', 'renderLoreGroupPicker', 'openSharedGroupDialog', 'paintGroupFieldRows', 'readGroupFieldDraft', 'previewGroupSchema', 'renderLoreFields', 'readLoreFieldsRaw', 'valuesFromFields', 'reconcileGroupFields', 'loreTypesWithForm', 'aiBlocksForGroup']) {
    assert.match(appSource, new RegExp(`function ${name}\\(`), `缺少 ${name}`);
  }
});
