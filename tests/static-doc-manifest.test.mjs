import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentHash, nonEmptyString, shortHash, verifyManifest } from '../static-doc-manifest.mjs';

// 静态文档清单门禁：清单哈希必须与磁盘内容一致，否则文档会静默过期。
// 这些用例只在内存里构造清单与内容，不读写真实仓库。

const sha = text => contentHash(text);

function fixture({ drift = false } = {}) {
  const sources = { 'a.mjs': 'export const a = 1;\n', 'b.mjs': 'export const b = 2;\n' };
  const docs = { 'docs/a.md': '# a\n', 'docs/b.md': '# b\n' };
  const manifest = {
    files: [
      { source: 'a.mjs', doc: 'docs/a.md', status: 'documented', sha256: sha(sources['a.mjs']) },
      { source: 'b.mjs', doc: 'docs/b.md', status: 'aggregated', sha256: drift ? sha('stale') : sha(sources['b.mjs']) }
    ],
    counts: { sources: 2, documented: 1, aggregated: 1, config: 0 }
  };
  return { manifest, contents: { ...sources, ...docs } };
}

test('a consistent manifest passes', () => {
  const { manifest, contents } = fixture();
  const result = verifyManifest({ manifest, contents });
  assert.deepEqual(result.errors, []);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.updates, []);
});

test('a drifted hash is reported with the source name', () => {
  const { manifest, contents } = fixture({ drift: true });
  const result = verifyManifest({ manifest, contents });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'HASH_MISMATCH');
  assert.match(result.errors[0].message, /^b\.mjs 哈希漂移/);
});

test('--write reports only the drifted entries and the corrected hash', () => {
  const { manifest, contents } = fixture({ drift: true });
  const result = verifyManifest({ manifest, contents, rewrite: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.updates, [{ source: 'b.mjs', sha256: sha('export const b = 2;\n') }]);
  // 用重算后的哈希再校验一次应当通过。
  manifest.files[1].sha256 = result.updates[0].sha256;
  assert.deepEqual(verifyManifest({ manifest, contents }).errors, []);
});

test('missing source and missing doc are separate failures', () => {
  const { manifest, contents } = fixture();
  const withoutSource = { ...contents };
  delete withoutSource['a.mjs'];
  const missingSource = verifyManifest({ manifest, contents: withoutSource });
  assert.ok(missingSource.errors.some(error => error.code === 'FILE_MISSING'));
  const withoutDoc = { ...contents };
  delete withoutDoc['docs/b.md'];
  const missingDoc = verifyManifest({ manifest, contents: withoutDoc });
  assert.ok(missingDoc.errors.some(error => error.code === 'DOC_MISSING'));
});

test('counts and statuses must match the entries', () => {
  const { manifest, contents } = fixture();
  manifest.counts = { sources: 3, documented: 2, aggregated: 1, config: 0 };
  const result = verifyManifest({ manifest, contents });
  assert.ok(result.errors.some(error => error.code === 'COUNT_MISMATCH' && /sources/.test(error.message)));
  assert.ok(result.errors.some(error => error.code === 'COUNT_MISMATCH' && /documented/.test(error.message)));
  manifest.counts = { sources: 2, documented: 1, aggregated: 1, config: 0 };
  manifest.files[0].status = 'unknown';
  assert.ok(verifyManifest({ manifest, contents }).errors.some(error => error.code === 'MANIFEST_INVALID' && /status/.test(error.message)));
});

test('duplicate sources and escaping paths are rejected', () => {
  const { manifest, contents } = fixture();
  manifest.files.push({ ...manifest.files[0] });
  manifest.files.push({ source: '../outside.mjs', doc: 'docs/a.md', status: 'documented', sha256: sha('x') });
  manifest.files.push({ source: 'c.mjs', doc: 'C:/abs/doc.md', status: 'documented', sha256: sha('x') });
  manifest.counts = { sources: 5, documented: 2, aggregated: 1, config: 0 };
  const codes = verifyManifest({ manifest, contents }).errors.map(error => error.code);
  assert.ok(codes.includes('DUPLICATE_SOURCE'));
  assert.equal(codes.filter(code => code === 'PATH_UNSAFE').length, 2);
});

test('a manifest without files is rejected instead of silently passing', () => {
  assert.equal(verifyManifest({ manifest: { files: [] }, contents: {} }).errors[0].code, 'MANIFEST_INVALID');
  assert.equal(verifyManifest({ manifest: {}, contents: {} }).errors[0].code, 'MANIFEST_INVALID');
});

test('a missing sha256 is reported once and does not throw', () => {
  const { manifest, contents } = fixture();
  delete manifest.files[1].sha256;
  const result = verifyManifest({ manifest, contents });
  assert.doesNotThrow(() => verifyManifest({ manifest, contents }));
  assert.ok(result.errors.some(error => error.code === 'MANIFEST_INVALID' && /sha256/.test(error.message)));
  assert.equal(result.errors.filter(error => error.code === 'HASH_MISMATCH').length, 0, '结构非法后不得再比较哈希');
  // 结构损坏属于需要人工确认的问题，--write 不得悄悄补上。
  assert.deepEqual(verifyManifest({ manifest, contents, rewrite: true }).updates, []);
});

test('a non-string sha256 is reported and skips the comparison', () => {
  const { manifest, contents } = fixture();
  for (const value of [123, null, { hash: 'x' }]) {
    manifest.files[1].sha256 = value;
    const result = verifyManifest({ manifest, contents });
    assert.ok(result.errors.some(error => error.code === 'MANIFEST_INVALID' && /sha256/.test(error.message)), `${JSON.stringify(value)} 应报 MANIFEST_INVALID`);
    assert.equal(result.errors.filter(error => error.code === 'HASH_MISMATCH').length, 0);
    assert.doesNotThrow(() => verifyManifest({ manifest, contents, rewrite: true }));
  }
});

test('a blank sha256 stops the comparison and is never auto-repaired', () => {
  // 空串与纯空白是字符串，但仍是结构非法：不能比较、也不能被 --write 补写。
  const { manifest, contents } = fixture();
  for (const value of ['', '   ', '\t\n']) {
    manifest.files[1].sha256 = value;
    const checked = verifyManifest({ manifest, contents });
    assert.ok(checked.errors.some(error => error.code === 'MANIFEST_INVALID' && /sha256/.test(error.message)), `${JSON.stringify(value)} 应报 MANIFEST_INVALID`);
    assert.equal(checked.errors.filter(error => error.code === 'HASH_MISMATCH').length, 0, `${JSON.stringify(value)} 不得再报 HASH_MISMATCH`);
    assert.deepEqual(verifyManifest({ manifest, contents, rewrite: true }).updates, [], `${JSON.stringify(value)} 不得被 --write 补写`);
  }
});

test('nonEmptyString is the single stop condition for field validity', () => {
  for (const value of ['abc', ' a ']) assert.equal(nonEmptyString(value), true, `${JSON.stringify(value)} 应有效`);
  for (const value of ['', '   ', null, undefined, 123, {}]) assert.equal(nonEmptyString(value), false, `${JSON.stringify(value)} 应无效`);
});

test('short hashes are formatted safely for non-string values', () => {
  assert.equal(shortHash('abcdef0123456789'), 'abcdef012345…');
  assert.match(shortHash(undefined), /非字符串/);
  assert.match(shortHash(42), /非字符串/);
});

test('content hashes ignore line endings but still detect content changes', () => {
  // CRLF、LF、单独 CR 归一化后必须同值：CI 在 Linux 检出 LF，Windows 默认检出 CRLF。
  assert.equal(contentHash(Buffer.from('a\r\nb')), contentHash(Buffer.from('a\nb')));
  assert.equal(contentHash('a\rb'), contentHash('a\nb'));
  assert.notEqual(contentHash('a\nb'), contentHash('a\nc'));
  assert.notEqual(contentHash('abc'), contentHash('abcd'));
});