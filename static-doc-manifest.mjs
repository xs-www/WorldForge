// 静态文档清单校验器（Sprint 5 收口）。
//
// 设计要点：
// - `docs/static/manifest.json` 是唯一的文档-源码对应表；每个条目的 sha256 必须等于源文件字节哈希。
// - 只校验「清单说的是否与磁盘一致」，不生成文档、不改源码。
// - `--write` 只重算哈希（清单里其余字段与顺序不动），并在写盘前列出哪些条目原本漂移。
// - 文档路径必须存在；source/doc 必须是仓库内相对路径，不允许绝对路径、`..` 或反斜杠逃逸。
//
// 用法：
//   node static-doc-manifest.mjs --check
//   node static-doc-manifest.mjs --write

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const STATUSES = Object.freeze(['documented', 'aggregated', 'config']);
const DEFAULT_MANIFEST = 'docs/static/manifest.json';

export function hashBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 诊断里只显示短哈希；非字符串也安全格式化，避免结构损坏时抛 TypeError。 */
export function shortHash(value) {
  return typeof value === 'string' ? `${value.slice(0, 12)}…` : `（非字符串：${typeof value}）`;
}

function unsafePath(path) {
  if (typeof path !== 'string' || !path.trim()) return true;
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith('/') || path.startsWith('\\')) return true;
  return path.split(/[\\/]/).includes('..');
}

/**
 * 校验清单与给定文件内容是否一致。
 * @param {{manifest: object, contents: Map<string, Buffer|string>|Record<string, Buffer|string>, rewrite?: boolean}} input
 * @returns {{checked: number, errors: Array<{code: string, message: string}>, updates: Array<{source: string, sha256: string}>}}
 */
export function verifyManifest({ manifest, contents, rewrite = false } = {}) {
  const errors = [], updates = [];
  const lookup = new Map(contents instanceof Map ? contents : Object.entries(contents || {}));
  const files = manifest?.files;

  if (!Array.isArray(files) || !files.length) {
    return { checked: 0, errors: [{ code: 'MANIFEST_INVALID', message: '清单缺少非空 files 数组' }], updates };
  }

  const seen = new Set();
  const tally = { documented: 0, aggregated: 0, config: 0 };

  files.forEach((entry, index) => {
    const label = entry?.source || `files[${index}]`;
    if (!entry || typeof entry !== 'object') { errors.push({ code: 'MANIFEST_INVALID', message: `${label} 不是对象` }); return; }
    for (const field of ['source', 'doc', 'status', 'sha256']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push({ code: 'MANIFEST_INVALID', message: `${label} 缺少 ${field}` });
    }
    if (!STATUSES.includes(entry.status)) errors.push({ code: 'MANIFEST_INVALID', message: `${label} 的 status 非法：${entry.status}` });
    else tally[entry.status] += 1;
    if (unsafePath(entry.source) || unsafePath(entry.doc)) {
      errors.push({ code: 'PATH_UNSAFE', message: `${label} 的 source/doc 必须是仓库内相对路径（${entry.source} → ${entry.doc}）` });
      return;
    }
    if (seen.has(entry.source)) errors.push({ code: 'DUPLICATE_SOURCE', message: `重复条目：${entry.source}` });
    seen.add(entry.source);

    const body = lookup.get(entry.source);
    if (body === undefined || body === null) {
      errors.push({ code: 'FILE_MISSING', message: `${entry.source} 在仓库中不存在（清单仍列着它）` });
    } else if (typeof entry.sha256 !== 'string') {
      // 结构已坏：不再比较哈希（上面已记 MANIFEST_INVALID）。`--write` 也不修，缺失字段属于需要人工确认的问题。
    } else {
      const actual = hashBytes(Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
      if (actual !== entry.sha256) {
        if (rewrite) updates.push({ source: entry.source, sha256: actual });
        else errors.push({ code: 'HASH_MISMATCH', message: `${entry.source} 哈希漂移：清单 ${shortHash(entry.sha256)} → 实际 ${shortHash(actual)}` });
      }
    }
    if (!(lookup.get(entry.doc) !== undefined && lookup.get(entry.doc) !== null)) {
      errors.push({ code: 'DOC_MISSING', message: `${entry.source} 指向的文档不存在：${entry.doc}` });
    }
  });

  const counts = manifest.counts;
  if (!counts || typeof counts !== 'object') errors.push({ code: 'COUNT_MISMATCH', message: '清单缺少 counts' });
  else {
    if (counts.sources !== files.length) errors.push({ code: 'COUNT_MISMATCH', message: `counts.sources=${counts.sources}，实际条目 ${files.length}` });
    for (const status of STATUSES) {
      if (counts[status] !== tally[status]) errors.push({ code: 'COUNT_MISMATCH', message: `counts.${status}=${counts[status]}，实际 ${tally[status]}` });
    }
  }

  return { checked: files.length, errors, updates };
}

/** 读入清单列出的全部 source 与 doc，供校验使用。缺失文件以 undefined 表示。 */
export async function loadContents(manifest, root = moduleRoot) {
  const contents = new Map();
  const paths = new Set();
  for (const entry of manifest?.files || []) {
    if (typeof entry?.source === 'string') paths.add(entry.source);
    if (typeof entry?.doc === 'string') paths.add(entry.doc);
  }
  for (const path of paths) {
    if (unsafePath(path)) continue;
    try { contents.set(path, await readFile(resolve(root, path))); }
    catch { contents.set(path, undefined); }
  }
  return contents;
}

async function main(argv) {
  const mode = argv.includes('--write') ? 'write' : 'check';
  const manifestPath = resolve(moduleRoot, DEFAULT_MANIFEST);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) {
    console.error(`[static-doc-manifest] MANIFEST_UNREADABLE: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const contents = await loadContents(manifest);
  const result = verifyManifest({ manifest, contents, rewrite: mode === 'write' });

  if (mode === 'write' && result.updates.length) {
    const bySource = new Map(result.updates.map(update => [update.source, update.sha256]));
    for (const entry of manifest.files) {
      if (bySource.has(entry.source)) entry.sha256 = bySource.get(entry.source);
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    for (const update of result.updates) console.log(`[static-doc-manifest] 已重算 ${update.source} → ${update.sha256.slice(0, 12)}…`);
  }

  if (result.errors.length) {
    for (const error of result.errors) console.error(`[static-doc-manifest] ${error.code}: ${error.message}`);
    console.error(`[static-doc-manifest] 校验失败：${result.errors.length} 处问题（共 ${result.checked} 个条目）`);
    process.exitCode = 1;
    return;
  }
  console.log(`[static-doc-manifest] 校验通过：${result.checked} 个条目的哈希、文档路径与计数全部一致${mode === 'write' && result.updates.length ? `（已重算 ${result.updates.length} 个哈希）` : ''}`);
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('static-doc-manifest.mjs'))) {
  await main(process.argv.slice(2));
}