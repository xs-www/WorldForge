import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnchorError, resolveAnchor, resolveAnchors, verifyDocument } from '../static-doc-anchors.mjs';

// 静态文档锚点校验器自身的契约：错误子串、歧义匹配、倒置区间与源码漂移都必须失败。

const sourceLines = [
  'function alpha() {',
  '  return 1;',
  '}',
  'function beta() {',
  '  return 2;',
  '}',
  '  const repeated = doThing();',
  '  const repeated = doThing();'
];

const anchors = {
  alpha: { lines: ['function alpha('] },
  beta: { lines: ['function beta('] },
  repeatedFirst: { lines: ['const repeated = doThing();'], count: 2, nth: 1 },
  repeatedSecond: { lines: ['const repeated = doThing();'], count: 2, nth: 2 }
};

test('a matching anchor resolves to its unique line', () => {
  assert.equal(resolveAnchor('alpha', anchors.alpha, sourceLines), 1);
  const resolved = resolveAnchors(anchors, sourceLines);
  assert.equal(resolved.get('beta'), 4);
  assert.equal(resolved.get('repeatedFirst'), 7);
  assert.equal(resolved.get('repeatedSecond'), 8);
});

test('a wrong expected substring fails', () => {
  assert.throws(() => resolveAnchor('alpha', { lines: ['function gamma('] }, sourceLines), (error) => {
    assert.ok(error instanceof AnchorError);
    assert.equal(error.code, 'ANCHOR_MISSING');
    return true;
  });
});

test('an ambiguous anchor fails instead of silently picking one', () => {
  assert.throws(() => resolveAnchor('dup', { lines: ['const repeated = doThing();'] }, sourceLines), (error) => {
    assert.equal(error.code, 'ANCHOR_AMBIGUOUS');
    return true;
  });
});

test('source drift invalidates an anchor', () => {
  const drifted = ['function alphaRenamed() {', '  return 1;', '}'];
  assert.throws(() => resolveAnchor('alpha', anchors.alpha, drifted), (error) => {
    assert.equal(error.code, 'ANCHOR_MISSING');
    return true;
  });
});

test('a single-line reference must match every expected substring of its anchor', () => {
  const doc = '| `alpha` | `L1` |';
  const ok = verifyDocument({ docText: doc, sourceLines, anchors });
  assert.deepEqual(ok.errors, []);
  const wrong = verifyDocument({ docText: '| `alpha` | `L4` |', sourceLines, anchors });
  assert.equal(wrong.errors.length, 1);
  assert.match(wrong.errors[0].message, /文档 L4 → 实际 L1/);
});

test('a reference that cannot be attributed to any anchor fails', () => {
  const result = verifyDocument({ docText: '| 未命名 | `L1` |', sourceLines, anchors });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /无法归属任何锚点/);
});

test('an inverted range fails, a forward range passes', () => {
  const forward = verifyDocument({ docText: '### 区间（`L1`–`L4`） <!-- anchor:alpha beta -->', sourceLines, anchors });
  assert.deepEqual(forward.errors, []);
  const inverted = verifyDocument({ docText: '### 区间（`L4`–`L1`） <!-- anchor:beta alpha -->', sourceLines, anchors });
  assert.ok(inverted.errors.some(error => /区间倒置/.test(error.message)), '倒置区间必须报错');
  assert.ok(inverted.errors.length >= 1);
});

test('independent references may decrease when they are not a range', () => {
  const result = verifyDocument({ docText: '两个点（`L4`、`L1`） <!-- anchor:beta alpha -->', sourceLines, anchors });
  assert.deepEqual(result.errors, []);
});

test('a route whose handler changed no longer matches its anchor', () => {
  // 路径与方法都不变，只把处理器换掉：锁定 handler 的锚点必须失配。
  const routeSource = [
    "if (req.method === 'POST' && req.url === '/api/ai/card') return json(res, 200, await callCardAgent(x));",
    "if (req.method === 'POST' && req.url === '/api/ai/card') return json(res, 200, await callFreeAgent(x));"
  ];
  const pathOnly = { lines: ["req.method === 'POST'", "'/api/ai/card'"] };
  const card = { lines: ["req.method === 'POST'", "'/api/ai/card'", 'callCardAgent'] };
  // 只看路径会歧义；加上 handler 才唯一。
  assert.throws(() => resolveAnchor('card', pathOnly, routeSource), (error) => {
    assert.equal(error.code, 'ANCHOR_AMBIGUOUS');
    return true;
  });
  assert.equal(resolveAnchor('card', card, routeSource), 1);
  // 路由被误接到 callFreeAgent 时，锁定 callCardAgent 的锚点不得再命中。
  const wrongHandler = [routeSource[1]];
  assert.throws(() => resolveAnchor('card', card, wrongHandler), (error) => {
    assert.equal(error.code, 'ANCHOR_MISSING');
    return true;
  });
});

test('anchor count must match reference count', () => {
  const result = verifyDocument({ docText: '三个引用（`L1`–`L4`、`L7`） <!-- anchor:alpha beta -->', sourceLines, anchors });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /锚点数.*与 L### 引用数/);
});
