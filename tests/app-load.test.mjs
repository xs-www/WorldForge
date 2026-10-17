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
    append() {}, appendChild() {}, prepend() {}, remove() {}, replaceChildren() {}, insertBefore() {},
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
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
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
  querySelector: () => fakeElement(),
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
  assert.doesNotThrow(() => sandbox.openLoreGroupDialog('create'), '新建资料组对话框不应抛错');
  assert.doesNotThrow(() => sandbox.openLoreGroupDialog('edit', sandbox.loreGroupKey(sandbox.loreGroup('world'))), '编辑资料组对话框不应抛错');
});

test('资料组字段与旧字段回填在真实数据形态下可见', async () => {
  const { sandbox } = await boot();
  sandbox.enterWorld('W01');
  sandbox.loadLore('W01');
  const fields = sandbox.loreGroup('world').fields.map(item => item.key);
  assert.equal(fields[0], 'details', '详细设定恒在');
  assert.ok(fields.includes('summary'), '应补回摘要');
  assert.ok(fields.includes('attributeA'), '应补回旧属性');
  const values = sandbox.entryValues(sandbox.readLore().find(entry => entry.id === 'W01'));
  assert.equal(values.summary, 's');
  assert.equal(values.attributeA, 'A');
});
