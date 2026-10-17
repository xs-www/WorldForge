import { parseLooseJson } from './ai-harness.mjs';

// ── 通用「模型输出 → JSON」规范化层（ADR-0033 §10）────────────────────────────
// 解析 agent 只负责识别、抽离、建立条目；把结果写成合法 JSON 不是它的职责。
// 本模块是一个与具体功能无关的规范化器，任何模型入口都可以用它：
// 1. `repairJsonModelOutput`：模型已经写了 JSON，但语法不合法（围栏、散文、未转义换行、
//    尾逗号、注释、全角标点、被输出上限截断、JSONL、字符串里再套一层 JSON）。
// 2. `parseLabeledSections`：模型按人类可读的「@@ 段 + 字段：值」记录格式输出，
//    由这里解析成结构化对象，完全不需要转义与括号配对。
// 3. `normalizeModelOutput`：先试 JSON，再试记录格式，返回统一的 `{format, value|sections, repairs}`。
//
// 只修语法，不猜内容：不会补字段、不会改写措辞、不会把缺失值编造成事实。
// 修改了哪些地方会记在 `repairs` 里，调用方可以据此提示作者或写诊断。

const FULL_WIDTH_STRUCTURAL = Object.freeze({ '｛': '{', '｝': '}', '［': '[', '］': ']', '：': ':', '，': ',', '“': '"', '”': '"' });

function emptyRepairs() {
  return { fence: false, prose: false, literalNewlines: 0, trailingCommas: 0, comments: 0, fullWidthPunctuation: 0, truncated: false, jsonl: false, unwrapped: false };
}

function mergeRepairs(...items) {
  const merged = emptyRepairs();
  for (const item of items) {
    if (!item) continue;
    for (const key of Object.keys(merged)) {
      if (typeof merged[key] === 'number') merged[key] += Number(item[key]) || 0;
      else if (item[key]) merged[key] = true;
    }
  }
  return merged;
}

function repairsApplied(repairs) {
  return Object.values(repairs || {}).some(value => (typeof value === 'number' ? value > 0 : Boolean(value)));
}

/** 去掉 Markdown 代码围栏行（```json / ```），保留其余文本。 */
function stripFences(text) {
  return String(text ?? '').replace(/^[ \t]*`{3,}[^\n]*$/gm, '');
}

/**
 * 扫描整段文本，只在字符串**之外**替换全角结构字符、去掉注释；
 * 在字符串**之内**把真实换行/制表符转义。字符串里未转义的引号无法安全还原，留给解析失败处理。
 */
function sanitizeJsonText(text) {
  const source = String(text ?? '');
  const repairs = emptyRepairs();
  let out = '', inString = false, escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) { out += char; escaped = false; continue; }
      if (char === '\\') { out += char; escaped = true; continue; }
      if (char === '"') { out += char; inString = false; continue; }
      if (char === '\n') { out += '\\n'; repairs.literalNewlines += 1; continue; }
      if (char === '\r') { out += '\\r'; repairs.literalNewlines += 1; continue; }
      if (char === '\t') { out += '\\t'; repairs.literalNewlines += 1; continue; }
      out += char;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      repairs.comments += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 1;
      repairs.comments += 1;
      continue;
    }
    const replaced = FULL_WIDTH_STRUCTURAL[char];
    if (replaced) { out += replaced; repairs.fullWidthPunctuation += 1; continue; }
    out += char;
  }
  return { text: out, repairs };
}

/** 输出被上限截断时，退回到最后一个完整对象并补齐括号，尽量保住前面的条目。 */
function truncatedJsonCandidates(value) {
  const start = value.search(/[[{]/);
  const body = start >= 0 ? value.slice(start) : value;
  const candidates = [];
  let cursor = body.length;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const end = body.lastIndexOf('}', cursor - 1);
    if (end < 0) break;
    const prefix = body.slice(0, end + 1);
    candidates.push(`${prefix}]}`, `${prefix}]`, `${prefix}}`, `${prefix}]}}`);
    cursor = end;
  }
  return candidates;
}

/** 每行一个 JSON 值的形态（JSONL / 逐条输出）。 */
function parseJsonLines(text) {
  const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
    .filter(line => !['[', ']', '{', '}'].includes(line));
  if (lines.length < 2) return undefined;
  const values = [];
  for (const line of lines) {
    const value = parseLooseJson(line);
    if (value === undefined || value === null || typeof value !== 'object') return undefined;
    values.push(value);
  }
  return values;
}

/** 字符串里再套一层 JSON 的形态（模型把 JSON 当字符串返回）。 */
function unwrapJsonString(value, format, repairs) {
  if (typeof value !== 'string') return undefined;
  const inner = parseLooseJson(value);
  if (inner === undefined || inner === null || typeof inner !== 'object') return undefined;
  return { value: inner, format, repairs: mergeRepairs(repairs, { unwrapped: true }) };
}

/**
 * 把「已经是 JSON 但语法有缺陷」的模型输出修成可解析的值。
 * 返回 `{value, format:'json'|'jsonl', repairs}`；完全无法解析时返回 `undefined`。
 */
export function repairJsonModelOutput(raw) {
  if (typeof raw !== 'string') return raw === undefined ? undefined : { value: raw, format: 'json', repairs: emptyRepairs() };
  const source = String(raw);
  if (!source.trim()) return undefined;
  const direct = parseLooseJson(source);
  if (direct !== undefined) {
    const repairs = mergeRepairs({ fence: /```/.test(source), prose: true });
    return unwrapJsonString(direct, 'json', repairs) || { value: direct, format: 'json', repairs };
  }

  const withoutFences = stripFences(source);
  const sanitized = sanitizeJsonText(withoutFences);
  const attempts = [sanitized.text, sanitized.text.replace(/,\s*([}\]])/g, '$1')];
  const trailingCommaCount = (sanitized.text.match(/,\s*[}\]]/g) || []).length;
  for (const candidate of attempts) {
    const parsed = parseLooseJson(candidate);
    if (parsed === undefined) continue;
    const repairs = mergeRepairs(sanitized.repairs, { fence: withoutFences !== source, trailingCommas: trailingCommaCount });
    return unwrapJsonString(parsed, 'json', repairs) || { value: parsed, format: 'json', repairs };
  }
  for (const candidate of truncatedJsonCandidates(sanitized.text)) {
    const parsed = parseLooseJson(candidate);
    if (parsed === undefined) continue;
    return { value: parsed, format: 'json', repairs: mergeRepairs(sanitized.repairs, { fence: withoutFences !== source, truncated: true }) };
  }
  const lines = parseJsonLines(sanitized.text);
  if (lines) return { value: lines, format: 'jsonl', repairs: mergeRepairs(sanitized.repairs, { fence: withoutFences !== source, jsonl: true }) };
  return undefined;
}

// ── 记录格式（人类可读，无需转义）──────────────────────────────────────────

const SECTION_PATTERN = /^\s*(?:@@|##+)\s*(.+?)\s*$/;
const BRACKET_SECTION_PATTERN = /^\s*【\s*(.+?)\s*】\s*$/;
const BULLET_PATTERN = /^\s*[-*·•]\s*(.*)$/;
const FIELD_PATTERN = /^\s*([^：:\n]{1,24}?)\s*[：:]\s*(.*)$/;

function normalizeLabel(value) {
  return String(value ?? '').replace(/[\s\u3000:：()（）]/g, '').toLowerCase();
}

function buildFieldIndex(fields) {
  const index = new Map();
  for (const field of Array.isArray(fields) ? fields : []) {
    for (const label of [field.key, ...(field.labels || [])]) {
      const normalized = normalizeLabel(label);
      if (normalized && !index.has(normalized)) index.set(normalized, field);
    }
  }
  return index;
}

function splitInlineList(value) {
  return String(value ?? '').split(/[、，,;；|]/).map(item => item.trim()).filter(Boolean);
}

function coerceFieldValue(field, value, kind) {
  if (field.kind === 'number') {
    const number = Number(String(value ?? '').replace(/[^\d.+-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }
  if (field.kind === 'lines' || kind === 'lines') return splitInlineList(value);
  return String(value ?? '').trim();
}

/**
 * 解析「@@ 段名 + 字段：值」的记录格式。
 * 与 JSON 相比它不需要转义：正文可以自然换行，列表可以自然分行，缺字段就留空。
 * @param {string} text 模型原文
 * @param {{fields: Array<{key: string, labels?: string[], kind?: 'text'|'lines'|'number'}>, marker?: string, sectionField?: string}} options
 * @returns {{sections: Array<Record<string, any>>, repairs: Record<string, any>}}
 */
export function parseLabeledSections(text, options = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fieldIndex = buildFieldIndex(options.fields);
  const sectionField = options.sectionField || 'section';
  const repairs = { sections: 0, fields: 0, ignoredLines: 0, preamble: false };
  const sections = [];
  if (!source.trim() || !fieldIndex.size) return { sections, repairs };

  let current = null, field = null, fieldKind = null;
  const startSection = name => {
    current = { [sectionField]: String(name).trim(), fields: {} };
    sections.push(current);
    repairs.sections += 1;
    field = null;
    fieldKind = null;
  };
  const appendToField = (rawLine, { bullet = false } = {}) => {
    if (!current || !field) { repairs.ignoredLines += 1; return; }
    const line = String(rawLine).trim();
    if (!line) return;
    if (field.kind === 'lines' || fieldKind === 'lines') {
      const existing = Array.isArray(current.fields[field.key]) ? current.fields[field.key] : [];
      if (bullet) existing.push(line);
      else if (existing.length) existing[existing.length - 1] = `${existing[existing.length - 1]} ${line}`.trim();
      else existing.push(line);
      current.fields[field.key] = existing;
      return;
    }
    if (field.kind === 'number') return;
    const previous = String(current.fields[field.key] ?? '');
    current.fields[field.key] = previous ? `${previous}\n${line}` : line;
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trimEnd();
    const sectionMatch = SECTION_PATTERN.exec(line) || BRACKET_SECTION_PATTERN.exec(line);
    if (sectionMatch) { startSection(sectionMatch[1]); continue; }
    const bulletMatch = BULLET_PATTERN.exec(line);
    if (bulletMatch && current && field) { appendToField(bulletMatch[1], { bullet: true }); continue; }
    const fieldMatch = FIELD_PATTERN.exec(line);
    const known = fieldMatch ? fieldIndex.get(normalizeLabel(fieldMatch[1])) : undefined;
    if (known && current) {
      field = known;
      fieldKind = known.kind || 'text';
      const inline = fieldMatch[2].trim();
      current.fields[known.key] = coerceFieldValue(known, inline, fieldKind);
      repairs.fields += 1;
      continue;
    }
    if (!current) { if (line.trim()) repairs.preamble = true; continue; }
    appendToField(line);
  }

  // 去掉只有占位词的字段（模型常写“无”“未知”来占位，那会变成假数据）。
  const PLACEHOLDERS = new Set(['无', '没有', '暂无', '未知', '空', 'n/a', 'none', '-', '—']);
  for (const section of sections) {
    for (const [key, value] of Object.entries(section.fields)) {
      if (Array.isArray(value)) {
        const items = value.map(item => String(item).trim()).filter(item => item && !PLACEHOLDERS.has(item.toLowerCase()));
        section.fields[key] = items;
      } else if (typeof value === 'string' && PLACEHOLDERS.has(value.toLowerCase())) {
        section.fields[key] = '';
      }
    }
  }
  return { sections, repairs };
}

/**
 * 通用入口：先按 JSON 修，再按记录格式解析。
 * @returns {{format: 'json'|'jsonl'|'record'|'value', value?: any, sections?: any[], repairs: object} | undefined}
 */
export function normalizeModelOutput(raw, options = {}) {
  const json = repairJsonModelOutput(raw);
  if (json) return json;
  if (!options.fields) return undefined;
  const record = parseLabeledSections(raw, options);
  if (record.sections.length) return { format: 'record', sections: record.sections, repairs: record.repairs };
  return undefined;
}

export { repairsApplied };
