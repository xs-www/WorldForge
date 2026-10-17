// 静态文档位置索引校验器（Sprint 5）。
//
// 设计要点：
// - 每个引用必须有「锚点」，锚点由期望源码子串组成；锚点必须**唯一**命中一行。
// - 文档里的 L### 只能由本校验器核对或重写（--write），不允许手写后无验证。
// - 单行引用验证全部期望子串；区间引用分别验证起止锚点并检查起点早于终点。
// - 无法归属锚点的 L### 一律视为错误，而不是放过。
//
// 用法：
//   node static-doc-anchors.mjs --check
//   node static-doc-anchors.mjs --write
//   node static-doc-anchors.mjs --check --doc docs/static/server.mjs.md --anchors docs/static/anchors.json

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));

export class AnchorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** 在源码中定位锚点：所有期望子串必须在同一行出现，且只有一行满足。 */
export function resolveAnchor(name, anchor, sourceLines) {
  if (!anchor || !Array.isArray(anchor.lines) || !anchor.lines.length) throw new AnchorError('ANCHOR_INVALID', `锚点 ${name} 缺少 lines`);
  const hits = [];
  sourceLines.forEach((line, index) => {
    if (anchor.lines.every(needle => line.includes(needle))) hits.push(index + 1);
  });
  const expectedCount = anchor.count ?? 1;
  if (hits.length !== expectedCount) {
    if (!hits.length) throw new AnchorError('ANCHOR_MISSING', `锚点 ${name} 未匹配任何行（期望子串：${anchor.lines.join(' + ')}）`);
    throw new AnchorError('ANCHOR_AMBIGUOUS', `锚点 ${name} 命中 ${hits.length} 行（${hits.join('、')}），期望 ${expectedCount} 行；请增加期望子串或用 count/nth 明确锁定`);
  }
  const position = anchor.nth ?? 1;
  if (position < 1 || position > hits.length) throw new AnchorError('ANCHOR_INVALID', `锚点 ${name} 的 nth=${position} 超出命中范围`);
  return hits[position - 1];
}

/** 预解析全部锚点；任何锚点不唯一都会在这里失败。 */
export function resolveAnchors(anchors, sourceLines) {
  const resolved = new Map();
  for (const [name, anchor] of Object.entries(anchors || {})) resolved.set(name, resolveAnchor(name, anchor, sourceLines));
  return resolved;
}

const BACKTICK = '`';

/** 从文档行中收集可归属的锚点候选名与引用位置。 */
export function scanLine(line, anchors) {
  const refs = [...line.matchAll(/`L(\d+)`/g)].map(match => ({ value: Number(match[1]), index: match.index }));
  if (!refs.length) return { refs: [], candidates: [] };
  const explicit = [...line.matchAll(/<!--\s*anchor:([^\s>]+(?:\s+[^\s>]+)*)\s*-->/g)]
    .flatMap(match => match[1].trim().split(/\s+/));
  const candidates = [...explicit];
  if (!candidates.length) {
    const route = line.match(/`(\/api\/[^`]*)`/);
    if (route) {
      const method = line.startsWith('|') ? line.split('|')[1].trim().split(/\s+/)[0] : '';
      const keyed = method ? `${method} ${route[1]}` : '';
      if (keyed && anchors[keyed]) candidates.push(keyed);
      else if (anchors[route[1]]) candidates.push(route[1]);
    }
  }
  if (!candidates.length) {
    for (const match of line.matchAll(/`([A-Za-z_$][\w$]*)(?:\([^`]*\))?`/g)) {
      if (anchors[match[1]] && !candidates.includes(match[1])) candidates.push(match[1]);
    }
  }
  return { refs, candidates };
}

/**
 * 校验（或重写）一份文档。
 * @returns {{ updates: Array<{line:number, text:string}>, refs:number, errors:Array<{line:number, message:string}> }}
 */
export function verifyDocument({ docText, sourceLines, anchors, rewrite = false }) {
  const resolved = resolveAnchors(anchors, sourceLines);
  const lines = docText.split('\n');
  const errors = [];
  const updates = [];
  let refs = 0;

  lines.forEach((line, index) => {
    const { refs: lineRefs, candidates } = scanLine(line, anchors);
    if (!lineRefs.length) return;
    refs += lineRefs.length;
    if (!candidates.length) {
      errors.push({ line: index + 1, message: 'L### 无法归属任何锚点；请为这一行添加 <!-- anchor:name -->' });
      return;
    }
    if (candidates.length !== lineRefs.length) {
      errors.push({ line: index + 1, message: `锚点数（${candidates.length}）与 L### 引用数（${lineRefs.length}）不一致；区间引用需要两个锚点` });
      return;
    }
    let text = line;
    lineRefs.forEach((ref, offset) => {
      const name = candidates[offset];
      const actual = resolved.get(name);
      const previous = candidates[offset - 1];
      const previousRef = lineRefs[offset - 1];
      const separator = previousRef ? line.slice(previousRef.index + String(previousRef.value).length + 3, ref.index) : '';
      const isRange = previousRef ? /^\s*[–-]\s*$/.test(separator) : false;
      if (isRange && resolved.get(previous) >= actual) {
        errors.push({ line: index + 1, message: `区间倒置：${previous}（L${resolved.get(previous)}）不早于 ${name}（L${actual}）` });
        return;
      }
      if (ref.value !== actual) {
        if (rewrite) text = text.replace(`${BACKTICK}L${ref.value}${BACKTICK}`, `${BACKTICK}L${actual}${BACKTICK}`);
        else errors.push({ line: index + 1, message: `位置索引与锚点不符：文档 L${ref.value} → 实际 L${actual}（锚点 ${name}）` });
      }
    });
    if (rewrite && text !== line) updates.push({ line: index + 1, text });
  });

  return { updates, refs, errors };
}

async function loadInputs(options) {
  const docPath = resolve(moduleRoot, options.doc);
  const anchorsPath = resolve(moduleRoot, options.anchors);
  if (!docPath.startsWith(moduleRoot)) throw new AnchorError('PATH_UNSAFE', '文档路径必须位于仓库内');
  const config = JSON.parse(await readFile(anchorsPath, 'utf8'));
  const sourcePath = resolve(moduleRoot, config.source);
  const sourceLines = (await readFile(sourcePath, 'utf8')).split('\n');
  const docText = await readFile(docPath, 'utf8');
  return { docPath, docText, sourceLines, anchors: config.anchors };
}

function parseArgs(argv) {
  const options = { mode: 'check', doc: 'docs/static/server.mjs.md', anchors: 'docs/static/anchors.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.mode = 'check';
    else if (arg === '--write') options.mode = 'write';
    else if (arg === '--doc') options.doc = argv[++i];
    else if (arg === '--anchors') options.anchors = argv[++i];
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('static-doc-anchors.mjs')) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const { docPath, docText, sourceLines, anchors } = await loadInputs(options);
    const result = verifyDocument({ docText, sourceLines, anchors, rewrite: options.mode === 'write' });
    if (options.mode === 'write') {
      const lines = docText.split('\n');
      for (const update of result.updates) lines[update.line - 1] = update.text;
      await writeFile(docPath, lines.join('\n'), 'utf8');
      console.log(`[static-doc-anchors] 已重写 ${result.updates.length} 行，共 ${result.refs} 处引用`);
    }
    if (result.errors.length) {
      for (const error of result.errors) console.error(`[static-doc-anchors] L${error.line}: ${error.message}`);
      console.error(`[static-doc-anchors] 校验失败：${result.errors.length} 处问题（共 ${result.refs} 处引用）`);
      process.exitCode = 1;
    } else {
      console.log(`[static-doc-anchors] 校验通过：${result.refs} 处引用全部命中唯一锚点`);
    }
  } catch (error) {
    console.error(`[static-doc-anchors] ${error.code || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  }
}
