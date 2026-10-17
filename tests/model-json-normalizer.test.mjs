import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeModelOutput, parseLabeledSections, repairJsonModelOutput } from '../model-json-normalizer.mjs';

// 通用「模型输出 → JSON」规范化层（ADR-0033 §10）：只修语法与结构，不猜内容。
// 这些用例覆盖 deepseek-flash 实测会出现的坏形态，以及记录格式（模型不必写 JSON）。

const fields = [
  { key: 'type', labels: ['类型'] },
  { key: 'name', labels: ['名称'] },
  { key: 'summary', labels: ['概述'] },
  { key: 'details', labels: ['正文'] },
  { key: 'tags', labels: ['标签'], kind: 'lines' },
  { key: 'order', labels: ['排序'], kind: 'number' }
];

test('已经合法的 JSON 原样通过，不做多余修补', () => {
  const payload = { world: { name: '余烬界' }, entries: [] };
  const result = repairJsonModelOutput(JSON.stringify(payload));
  assert.deepEqual(result.value, payload);
  assert.equal(result.format, 'json');
  assert.equal(result.repairs.literalNewlines, 0);
  assert.equal(result.repairs.truncated, false);
});

test('围栏与前后散文只作为外壳被剥掉', () => {
  const result = repairJsonModelOutput('好的，以下是整理结果：\n```json\n{"entries":[{"name":"甲"}]}\n```\n请确认。');
  assert.deepEqual(result.value, { entries: [{ name: '甲' }] });
  assert.equal(result.repairs.fence, true);
});

test('字符串里未转义的换行/制表符会被转义而不是丢掉内容', () => {
  const raw = '{"details":"第一行\n第二行\t制表"}';
  const result = repairJsonModelOutput(raw);
  assert.equal(result.value.details, '第一行\n第二行\t制表');
  assert.equal(result.repairs.literalNewlines, 2);
});

test('尾逗号、注释与全角标点都能修回来', () => {
  const raw = '{"entries":[{"name":"甲",},], /* 说明 */}\n// 结束';
  const result = repairJsonModelOutput(raw);
  assert.deepEqual(result.value, { entries: [{ name: '甲' }] });
  assert.ok(result.repairs.trailingCommas >= 1 || result.repairs.comments >= 1);

  const fullWidth = '｛“entries”：［｛“name”：“乙”，｝］｝';
  const fixed = repairJsonModelOutput(fullWidth);
  assert.deepEqual(fixed.value, { entries: [{ name: '乙' }] });
  assert.ok(fixed.repairs.fullWidthPunctuation > 0);
});

test('输出被截断时退回到最后一个完整对象', () => {
  const raw = '{"entries":[{"name":"甲"},{"name":"乙","details":"被截';
  const result = repairJsonModelOutput(raw);
  assert.deepEqual(result.value, { entries: [{ name: '甲' }] });
  assert.equal(result.repairs.truncated, true);
});

test('逐行 JSON 与「字符串里再套一层 JSON」都能被识别', () => {
  const lines = repairJsonModelOutput('{"name":"甲"}\n{"name":"乙"}');
  assert.equal(lines.format, 'jsonl');
  assert.deepEqual(lines.value, [{ name: '甲' }, { name: '乙' }]);

  const doubleEncoded = repairJsonModelOutput(JSON.stringify(JSON.stringify({ name: '丙' })));
  assert.deepEqual(doubleEncoded.value, { name: '丙' });
  assert.equal(doubleEncoded.repairs.unwrapped, true);
});

test('完全不可解析时返回 undefined，而不是编造结果', () => {
  assert.equal(repairJsonModelOutput('这不是 JSON，只是一段说明。'), undefined);
  assert.equal(repairJsonModelOutput(''), undefined);
  assert.equal(repairJsonModelOutput('   \n  '), undefined);
});

test('记录格式：段落、字段、多行正文、列表与数字', () => {
  const text = `这是模型的说明文字，应被忽略。

@@ 世界
名称：余烬界
概述：一座靠炉心余热运转的城邦。
正文：
第一段世界描述。
第二段世界描述。

@@ 条目
类型：角色
名称：议员甲
概述：首席议员。
正文：
第一行
第二行
标签：
- 议会
- 议员
排序：3

@@ 条目
类型：势力
名称：灰烬议会
标签：势力、权力
`;
  const { sections, repairs } = parseLabeledSections(text, { fields });
  assert.equal(sections.length, 3);
  assert.equal(sections[0].section, '世界');
  assert.equal(sections[0].fields.name, '余烬界');
  assert.equal(sections[0].fields.details, '第一段世界描述。\n第二段世界描述。');
  assert.equal(sections[1].fields.type, '角色');
  assert.equal(sections[1].fields.details, '第一行\n第二行');
  assert.deepEqual(sections[1].fields.tags, ['议会', '议员']);
  assert.equal(sections[1].fields.order, 3);
  assert.deepEqual(sections[2].fields.tags, ['势力', '权力']);
  assert.equal(repairs.preamble, true);
});

test('记录格式：占位词被清空，未知标签按正文续行处理', () => {
  const { sections } = parseLabeledSections(`@@ 条目
类型：角色
名称：甲
概述：无
正文：正文第一行
这一行是正文的续行，不是字段
约束：无
`, { fields });
  assert.equal(sections[0].fields.summary, '');
  assert.ok(sections[0].fields.details.includes('这一行是正文的续行'));
  assert.equal(sections[0].fields.constraints, undefined);
});

test('记录格式也接受 ## 与【】段落标记', () => {
  const markdown = parseLabeledSections('## 条目\n名称：甲\n正文：正文。\n', { fields });
  assert.equal(markdown.sections[0].fields.name, '甲');
  const bracket = parseLabeledSections('【条目】\n名称：乙\n', { fields });
  assert.equal(bracket.sections[0].fields.name, '乙');
});

test('通用入口：JSON 优先，其次记录格式，都不行才返回 undefined', () => {
  const fromJson = normalizeModelOutput('{"entries":[{"name":"甲"}]}', { fields });
  assert.equal(fromJson.format, 'json');
  const fromRecord = normalizeModelOutput('@@ 条目\n名称：甲\n', { fields });
  assert.equal(fromRecord.format, 'record');
  assert.equal(fromRecord.sections[0].fields.name, '甲');
  assert.equal(normalizeModelOutput('一段说明', { fields }), undefined);
  assert.equal(normalizeModelOutput('一段说明'), undefined);
});
