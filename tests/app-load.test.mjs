import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 顶层求值一旦抛出（例如 const 的 TDZ、引用不存在的全局、被误删的函数），
// 整个 app.js 不会执行，页面会永远停在「正在连接 SQLite…」或干脆不响应。
// `node --check` 只做语法检查，frontend-dom-contract 只比对 id 文本，都抓不到这类问题。
// 这里把 dist/ 的真实模块按顺序装进一个隔离上下文，再用最小 DOM 替身真的跑一遍引导与几个主视图。
const read = file => readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');

function fakeElement() {
  const element = {
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, children: [], value: '', textContent: '', hidden: false, checked: false, disabled: false, open: false,
    append(...nodes) { this.children.push(...nodes); this.childElementCount = this.children.length; }, appendChild(node) { this.children.push(node); this.childElementCount = this.children.length; return node; }, prepend() {}, remove() {}, insertBefore() {},
    replaceChildren(...nodes) { this.children = nodes; this.childElementCount = nodes.length; },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    removeAttribute() {}, focus() {}, blur() {}, select() {}, click() {}, scrollIntoView() {},
    querySelector: () => fakeElement(), querySelectorAll: () => [], closest: () => null,
    getContext: () => null, toDataURL: () => '', reportValidity: () => true, reset() {}, showModal() { this.open = true; }, close() { this.open = false; },
    get firstChild() { return fakeElement(); }, get lastChild() { return fakeElement(); },
    get options() { return []; }, get files() { return []; }
  };
  element.parentElement = element;
  return element;
}

const loreFixture = [
  { id: 'W01', type: 'world', name: '甲世界', status: 'canon', truthScope: 'objective', worldId: 'W01', summary: 's', details: 'd', constraints: ['c'], openQuestions: ['q'], attributes: { a: 'A', b: 'B', c: 'C' } },
  { id: 'LOC-W01-1', type: 'location', name: '大陆', status: 'proposed', truthScope: 'objective', worldId: 'W01', summary: '', details: '', constraints: [], openQuestions: [], relationIds: ['W01'], location: { kind: 'continent', parentId: '' } },
  { id: 'FAC-W01-1', type: 'faction', name: '势力', status: 'proposed', truthScope: 'objective', worldId: 'W01', summary: '', details: '', constraints: [], openQuestions: [], relationIds: [] },
  { id: 'TML-W01-1', type: 'timeline', name: '编年史', status: 'proposed', truthScope: 'objective', worldId: 'W01', summary: '', details: '', constraints: [], openQuestions: [], chronicle: { kind: 'chronicle' } }
];

function makeSandbox() {
  const store = new Map([['worldforge-lore-entries-v1', JSON.stringify(loreFixture)]]);
  const elementCache = (() => {
    const cache = new Map();
    return selector => { if (!cache.has(selector)) cache.set(selector, fakeElement()); return cache.get(selector); };
  })();
    const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, queueMicrotask() {},
  URL, URLSearchParams, TextEncoder, TextDecoder, Date, Math, JSON, Promise, Error, Map, Set, RegExp, Number, String, Array, Object, Boolean, Intl,
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  location: { href: 'http://127.0.0.1:8080/', pathname: '/', replace() {} },
  navigator: { userAgent: 'node' },
  fetch: async () => {
    const payload = { schemaVersion: 3, initialized: true, revision: 1, lastSavedBy: 'test', loreEntries: loreFixture, cardDrafts: [], keywords: [], loreGroups: [], notes: {} };
    const text = JSON.stringify(payload);
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  },
  Blob: class {}, FormData: class {}, FileReader: class { readAsDataURL() {} },
  Image: class { set src(value) { this.onload?.(); } },
  HTMLCanvasElement: class { getContext() { return null; } }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.document = {
  currentScript: { src: 'http://127.0.0.1:8080/app.js' },
  documentElement: { dataset: {}, classList: { toggle() {} } },
  body: fakeElement(),
  querySelector: selector => elementCache(selector),
  querySelectorAll: () => [],
  createElement: () => fakeElement(),
  createTextNode: value => ({ nodeType: 3, textContent: String(value) }),
  getElementById: () => fakeElement(),
  addEventListener() {},
  title: ''
  };
  return sandbox;
}

async function boot() {
  const sandbox = makeSandbox();
  const context = vm.createContext(sandbox);
  for (const file of ['geography.js', 'chronicle.js', 'world-scope.js', 'relation-picker.js', 'lore-groups.js', 'cards.js', 'app.js']) {
    const source = (await read(file)).split('document.currentScript.src').join(JSON.stringify(`http://127.0.0.1:8080/${file}`));
    vm.runInContext(source, context, { filename: file });
  }
  await new Promise(resolve => setImmediate(resolve));
  return { context, sandbox };
}

test('app.js 与前置脚本可以真正加载并进入世界视图', async () => {
  const { sandbox } = await boot();
  assert.equal(typeof sandbox.renderLoreFields, 'function');
  assert.equal(typeof sandbox.loreGroup, 'function');
  assert.equal(typeof sandbox.updateLoreBadge, 'function');
  // 进入世界会依次走 resetLoreEditor → renderLoreList → updateLoreBadge；
  // 任何一个被误删都会在这里抛 ReferenceError（曾经就是 updateLoreBadge 被删，导致列表全空）。
  assert.doesNotThrow(() => sandbox.enterWorld('W01'), 'enterWorld 不应抛错');
  assert.doesNotThrow(() => sandbox.selectLoreType('timeline'), '编年史视图不应抛错');
  assert.doesNotThrow(() => sandbox.selectLoreType('location'), '地理视图不应抛错');
  assert.doesNotThrow(() => sandbox.selectLoreType('faction'), '自定义资料组视图不应抛错');
  assert.doesNotThrow(() => sandbox.loadLore('W01'), '打开条目不应抛错');
  assert.doesNotThrow(() => sandbox.openLoreGroupDialog('list'), '资料组列表不应抛错');
  const formBody = sandbox.document.querySelector('#groupFormBody');
  const pickRow = sandbox.document.querySelector('#groupPickRow');
  const pickList = sandbox.document.querySelector('#groupPickList');
  assert.equal(pickRow.hidden, false, '列表态应显示组列表');
  assert.equal(formBody.hidden, true, '列表态应隐藏表单');
  assert.ok((pickList.children?.length ?? 0) >= 5, '列表里应列出五个预置组');
  assert.doesNotThrow(() => sandbox.openLoreGroupDialog('create'), '新建资料组对话框不应抛错');
  assert.equal(sandbox.document.querySelector('#groupFormBody').hidden, false, '新建态应显示表单');
  assert.equal(sandbox.document.querySelector('#groupBackRow').hidden, true, '新建态不显示「换个组」');
  assert.doesNotThrow(() => sandbox.openLoreGroupDialog('edit', sandbox.loreGroupKey(sandbox.loreGroup('world'))), '编辑资料组对话框不应抛错');
  assert.equal(sandbox.document.querySelector('#groupBackRow').hidden, false, '编辑态应能回到列表');
  assert.match(String(sandbox.document.querySelector('#groupDialogTitle').textContent), /^编辑：/, '编辑态标题应写清在编辑哪个组');
  assert.doesNotThrow(() => sandbox.fillLoreGroupDialog('list'), '返回列表不应抛错');
  await assert.doesNotReject(sandbox.openSettings(), '打开设置不应抛错（含已移除控件的旧调用）');
  assert.equal(sandbox.document.querySelector('#groupFormBody').hidden, true, '返回列表后表单隐藏');
});

test('资料组字段与旧字段回填在真实数据形态下可见', async () => {
  const { sandbox } = await boot();
  sandbox.enterWorld('W01');
  sandbox.loadLore('W01');
  const fields = sandbox.loreGroup('world').fields.map(item => item.key);
  assert.ok(!fields.includes('details'), '详细设定是内置块，不该出现在组字段里');
  assert.equal(fields[0], 'summary', '旧字段被回填到组字段');
  assert.ok(fields.includes('summary'), '应补回摘要');
  assert.ok(fields.includes('attributeA'), '应补回旧属性');
  const values = sandbox.entryValues(sandbox.readLore().find(entry => entry.id === 'W01'));
  assert.equal(values.summary, 's');
  assert.equal(values.attributeA, 'A');
});

test('资料组作用范围：世界内新建默认仅当前世界，且可以改选共享', async () => {
  const { sandbox } = await boot();
  const stored = () => JSON.parse(sandbox.localStorage.getItem('worldforge-lore-groups-v1') || '[]');
  sandbox.enterWorld('W01');

  sandbox.openLoreGroupDialog('create');
  const scope = sandbox.document.querySelector('#groupScope');
  assert.equal(scope.value, '__world__', '世界内新建的组默认只属于当前世界');
  assert.equal(scope.disabled, false, '作用范围必须可操作，而不是看起来能点却点不动');
  sandbox.document.querySelector('#groupLabel').value = '本世界势力';
  sandbox.saveLoreGroupFromDialog();
  assert.equal(stored().find(group => group.label === '本世界势力').worldId, 'W01');

  // 作者主动改选「所有世界共享」后保存：写入共享组
  sandbox.openLoreGroupDialog('create');
  sandbox.document.querySelector('#groupLabel').value = '共享历法';
  sandbox.document.querySelector('#groupScope').value = '__shared__';
  sandbox.updateGroupScopeHint();
  sandbox.saveLoreGroupFromDialog();
  assert.equal(stored().find(group => group.label === '共享历法').worldId, '');
});

test('逐条归组：改资料组并保存会把条目移到目标组', async () => {
  const { sandbox } = await boot();
  const lore = JSON.parse(sandbox.localStorage.getItem('worldforge-lore-entries-v1') || '[]');
  lore.push({ id: 'FAC-W01-101', type: 'faction', name: '势力甲', worldId: 'W01', status: 'proposed', truthScope: 'objective', values: { details: '旧正文' } });
  sandbox.localStorage.setItem('worldforge-lore-entries-v1', JSON.stringify(lore));
  sandbox.enterWorld('W01');
  sandbox.selectLoreType('faction');
  sandbox.loadLore('FAC-W01-101');
  const select = sandbox.document.querySelector('#loreGroupSelect');
  assert.ok([...select.children].some(option => option.value === 'misc'), '资料组下拉必须包含「设定」组');
  assert.equal(select.value, 'faction');
  select.value = 'misc';
  sandbox.saveLore();
  const moved = sandbox.readLore().find(entry => entry.id === 'FAC-W01-101');
  assert.equal(moved.type, 'misc', '保存后条目应归入目标组');
});

test('批量归组：勾选后一次把多条资料移到目标组', async () => {
  const { sandbox } = await boot();
  const lore = JSON.parse(sandbox.localStorage.getItem('worldforge-lore-entries-v1') || '[]');
  lore.push(
    { id: 'FAC-W01-101', type: 'faction', name: '势力甲', worldId: 'W01', status: 'proposed', truthScope: 'objective', values: { details: '甲' } },
    { id: 'FAC-W01-102', type: 'faction', name: '势力乙', worldId: 'W01', status: 'proposed', truthScope: 'objective', values: { details: '乙' } }
  );
  sandbox.localStorage.setItem('worldforge-lore-entries-v1', JSON.stringify(lore));
  sandbox.enterWorld('W01');
  sandbox.selectLoreType('faction');
  const rows = sandbox.document.querySelector('#loreList').children;
  assert.ok(rows.length >= 2, '列表里应出现两条势力资料');
  const row = rows.find(item => item.children && item.children[0] && item.children[0].type === 'checkbox');
  assert.ok(row, '每行都应带勾选框');
  row.children[0].checked = true;
  row.children[0].onchange();
  assert.match(String(sandbox.document.querySelector('#loreBulkCount').textContent), /已选 1 条/);
  assert.equal(sandbox.document.querySelector('#loreBulkMove').disabled, false);
  sandbox.document.querySelector('#loreBulkGroup').value = 'misc';
  sandbox.applyLoreBulkMove();
  const moved = sandbox.readLore().filter(entry => entry.type === 'misc');
  assert.equal(moved.length, 1, '只移动勾选的那一条');
  assert.equal(sandbox.readLore().filter(entry => entry.type === 'faction').length, 2, '另外两条势力资料保持不动');
});

test('世界内导入设定：默认并入当前世界，列表页仍是新建世界', async () => {
  const { sandbox } = await boot();
  const calls = [];
  sandbox.fetch = async (url, options = {}) => {
    const href = String(url);
    let body = {};
    try { body = options.body ? JSON.parse(options.body) : {}; } catch { body = {}; }
    calls.push({ href, body, method: options.method || 'GET' });
    const reply = payload => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });
    if (href.endsWith('lore-import/parse')) return reply({ mode: 'existing', worldId: 'W01', world: { name: '甲世界', summary: '', details: '' }, entries: [], groups: [], warnings: [], stats: { chunks: 1, characters: 4, counts: {}, total: 0 }, agent: { presetId: 'lore-writer' }, model: 'fake' });
    if (href.endsWith('lore-import/commit')) return reply({ mode: 'existing', worldId: 'W01', world: { id: 'W01' }, entries: [], warnings: [], revision: 9 });
    return reply({ schemaVersion: 3, initialized: true, revision: 1, loreEntries: [], cardDrafts: [], keywords: [], loreGroups: [], notes: {} });
  };

  sandbox.enterWorld('W01');
  sandbox.openLoreImport('W01');
  assert.equal(sandbox.document.querySelector('#loreImportWorldNameRow').hidden, true, '并入已有世界时不再询问世界名');
  assert.match(String(sandbox.document.querySelector('#loreImportTarget').textContent), /W01/);

  sandbox.document.querySelector('#loreImportSource').value = '一段设定';
  await sandbox.parseLoreImport();
  const parseCall = calls.find(call => call.href.endsWith('lore-import/parse'));
  assert.equal(parseCall.body.intoWorld, 'W01', '解析请求必须带上目标世界');

  await sandbox.saveLoreImport();
  const commitCall = calls.find(call => call.href.endsWith('lore-import/commit'));
  assert.equal(commitCall.body.mode, 'existing', '保存时必须使用并入模式');
  assert.equal(commitCall.body.plan.worldId, 'W01');

  sandbox.openLoreImport();
  assert.equal(sandbox.document.querySelector('#loreImportWorldNameRow').hidden, false);
  assert.match(String(sandbox.document.querySelector('#loreImportTarget').textContent), /将建立新世界/);
});

test('默认新增组只属于当前世界；共享组只能在设置里建', async () => {
  const { sandbox } = await boot();
  const stored = () => JSON.parse(sandbox.localStorage.getItem('worldforge-lore-groups-v1') || '[]');
  sandbox.enterWorld('W01');

  // 世界内新建：默认写成本世界的组
  sandbox.openLoreGroupDialog('create');
  sandbox.document.querySelector('#groupLabel').value = '本世界势力';
  sandbox.saveLoreGroupFromDialog();
  const local = stored().find(group => group.label === '本世界势力');
  assert.ok(local, '新组应写入内容库');
  assert.equal(local.worldId, 'W01', '默认应属于当前世界');

  // 世界内的列表不混入共享组
  sandbox.openLoreGroupDialog('list');
  assert.equal(sandbox.document.querySelector('#groupPickList').children.length >= 5, true, '列表至少有五个预置组');

  // 从设置进入共享管理后新建：写共享组
  sandbox.openSharedGroupDialog();
  sandbox.fillLoreGroupDialog('create');
  sandbox.document.querySelector('#groupLabel').value = '历法';
  sandbox.saveLoreGroupFromDialog();
  const shared = stored().find(group => group.label === '历法');
  assert.ok(shared, '共享组应写入内容库');
  assert.equal(shared.worldId, '', '共享组的 worldId 为空');

  // 共享组在另一个世界也能看到，本世界的组不能
  sandbox.enterWorld('W02');
  assert.equal(sandbox.loreGroupsView().some(group => group.label === '历法'), true, '共享组跨世界可见');
  assert.equal(sandbox.loreGroupsView().some(group => group.label === '本世界势力'), false, '本世界的组不外泄');
});

test('卡牌必须归属世界：没有世界拒绝保存，选了世界后写入 worldId', async () => {
  const { sandbox } = await boot();
  sandbox.enterWorld('W01');
  sandbox.resetCardEditor();
  const worldSelect = sandbox.document.querySelector('#cardWorldId');
  assert.equal(worldSelect.value, 'W01', '进入世界后新卡牌默认属于当前世界');
  assert.ok([...worldSelect.children].some(option => option.value === 'W01'), '世界下拉必须列出已有世界');

  sandbox.document.querySelector('#cardName').value = '甲卡';
  worldSelect.value = '';
  await sandbox.saveCurrentCard();
  assert.equal(sandbox.readCards().length, 0, '没有所属世界时不能保存');

  worldSelect.value = 'W01';
  await sandbox.saveCurrentCard();
  assert.equal(sandbox.readCards().length, 1, '选了世界后应保存成功');
  assert.equal(sandbox.readCards()[0].worldId, 'W01');
});

test('卡牌库按世界筛选，并在卡面显示世界徽标', async () => {
  const { sandbox } = await boot();
  sandbox.localStorage.setItem('worldforge-card-drafts-v1', JSON.stringify([
    { id: 'CARD-W01-0001', name: '甲卡', type: 'minion', worldId: 'W01', rarity: 'common', keywordUsages: [] },
    { id: 'CARD-X-0001', name: '散卡', type: 'spell', worldId: '', rarity: 'rare', keywordUsages: [] }
  ]));
  const list = () => sandbox.document.querySelector('#cardList');
  sandbox.renderCards();
  assert.equal(list().children.length, 2, '默认「全部世界」显示所有卡牌');
  assert.equal(list().children[0].children[1].textContent, '甲世界', '卡面徽标写世界名');
  assert.equal(list().children[1].children[1].textContent, '未归属');

  sandbox.document.querySelector('#cardLibraryWorld').value = 'W01';
  sandbox.renderCards();
  assert.equal(list().children.length, 1, '按世界筛选后只剩该世界的卡牌');
  assert.equal(list().children[0].dataset.world, 'W01');

  sandbox.document.querySelector('#cardLibraryWorld').value = '';
  sandbox.renderCards();
  assert.equal(list().children.length, 1, '未归属筛选只显示没有世界的卡牌');
  assert.equal(list().children[0].dataset.world, '');
});

test('原画跟随绑定目标的世界，并可按世界筛选', async () => {
  const { sandbox } = await boot();
  const assetId = 'ART-00000000-0000-0000-0000-000000000001';
  sandbox.localStorage.setItem('worldforge-card-drafts-v1', JSON.stringify([
    { id: 'CARD-W01-0001', name: '甲卡', type: 'minion', worldId: 'W01', rarity: 'common', keywordUsages: [], artAssetId: assetId }
  ]));
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ assets: [{ id: assetId, targetType: 'card', targetId: 'CARD-W01-0001', purpose: 'card_art', prompt: 'p', model: 'm', size: '2K', mimeType: 'image/png', fileName: 'a.png', status: 'proposed', provenance: 'ai_generated', createdAt: '2026-10-21T00:00:00.000Z', worldId: 'W01' }] }),
    text: async () => ''
  });
  await sandbox.refreshArtAssets();
  const entries = sandbox.artworkEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].worldId, 'W01', '原画继承绑定卡牌的世界');
  assert.equal(entries[0].worldName, '甲世界');

  sandbox.document.querySelector('#artworkWorld').value = 'W02';
  sandbox.renderArtworkGallery();
  assert.match(String(sandbox.document.querySelector('#artworkCount').textContent), /^0 \/ 1/, '其它世界筛选下不显示');
  sandbox.document.querySelector('#artworkWorld').value = 'W01';
  sandbox.renderArtworkGallery();
  assert.match(String(sandbox.document.querySelector('#artworkCount').textContent), /^1 \/ 1/);
  const article = sandbox.document.querySelector('#artworkGallery').children[0];
  assert.equal(article.dataset.world, 'W01');
});
