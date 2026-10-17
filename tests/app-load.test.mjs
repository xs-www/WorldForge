import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 顶层求值一旦抛出（例如 const 的 TDZ、引用不存在的全局），整个 app.js 不会执行，
// 页面会永远停在「正在连接 SQLite…」。`node --check` 只做语法检查，抓不到这类错误；
// 这里用最小的 DOM/网络替身在隔离上下文里真正求值一次，只断言「加载阶段没有抛错」。
const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');

function fakeElement() {
  const element = {
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, children: [], value: '', textContent: '', hidden: false, checked: false, disabled: false,
    append() {}, appendChild() {}, prepend() {}, remove() {}, replaceChildren() {}, insertBefore() {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    removeAttribute() {}, focus() {}, blur() {}, select() {}, click() {}, scrollIntoView() {},
    querySelector: () => fakeElement(), querySelectorAll: () => [], closest: () => null,
    getContext: () => null, toDataURL: () => '', reportValidity: () => true, reset() {}, showModal() {}, close() {},
    get firstChild() { return fakeElement(); }, get lastChild() { return fakeElement(); },
    get options() { return []; }, get files() { return []; }
  };
  element.parentElement = element;
  return element;
}

const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, queueMicrotask() {},
  URL, URLSearchParams, TextEncoder, TextDecoder, Date, Math, JSON, Promise, Error,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
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
sandbox.document = {
  currentScript: { src: 'http://127.0.0.1:8080/app.js' },
  documentElement: { dataset: {}, classList: { toggle() {} } },
  body: fakeElement(),
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  createElement: () => fakeElement(),
  getElementById: () => fakeElement(),
  addEventListener() {},
  title: ''
};
// dist/lore-groups.js 等前置脚本在这里只需提供类型，占位对象足以让 app.js 完成加载。
for (const name of ['WorldforgeGeography', 'WorldforgeChronicle', 'WorldforgeWorldScope', 'WorldforgeRelationPicker', 'WorldforgeCards', 'WorldforgeLoreGroups']) {
  sandbox[name] = {
    normalizeKind: value => value || 'region', kinds: {}, build() { return { roots: [], children: new Map(), orphans: [], visibleIds: new Set() }; },
    buildTree() { return { roots: [], children: new Map(), orphans: [], visibleIds: new Set() }; },
    normalize: () => ({}), groups: () => [], worldIdOf: () => '', loreOfWorld: () => [], searchWorlds: () => [],
    reassign: () => ({ entries: [], moved: 0 }), nextWorldId: () => 'W01', filter: () => [], summarize: () => [],
    missingCount: () => 0, toggle: () => [], remove: () => [], subtypeText: () => '', subtypeOptions: () => [],
    legacySubtypeLabels: {}, SUBTYPE_LIMIT: 60, isCardableLore: () => false, defaultTypeForLore: () => 'minion',
    compileDescription: () => ({ runs: [], text: '', lines: [] }), normalizeSubtype: () => ({ tribeId: '', spellSchoolId: '' }),
    allGroups: () => [], deriveGroups: () => [], groupOf: () => null, normalizeGroup: () => null, normalizeGroups: () => [],
    normalizeStoredGroups: () => [], migrateLegacyGroups: () => [], groupsForWorld: () => [], prompt: () => 'world',
    IMAGE_KEYS: [], FIXED_GROUPS: [], FIXED_IDS: new Set(), LEGACY_FIELD_LABELS: {}, MINIMAL_FIELDS: [{ key: 'details', label: '详细设定', kind: 'multiline' }],
    slugify: () => '', createGroup: () => null, imageKey: () => 'other', groupResponseSchema: () => ({})
  };
}

test('app.js 在加载阶段不抛出（顶层求值可完成）', async () => {
  const context = vm.createContext(sandbox);
  sandbox.addEventListener = () => {};
  assert.doesNotThrow(() => vm.runInContext(source, context, { filename: 'app.js' }));
  // 让末尾的 bootstrap() 微任务跑完，避免未处理拒绝泄漏到其它用例
  await new Promise(resolve => setImmediate(resolve));
  // 加载成功后关键函数应当已定义（TDZ / 语法错误会让它们根本不存在）
  assert.equal(typeof sandbox.renderLoreFields, 'function');
  assert.equal(typeof sandbox.loreGroup, 'function');
  assert.equal(typeof sandbox.normalizeLore, 'function');
});
