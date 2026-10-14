import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');

test('browser API requests follow the script mount path', () => {
  assert.match(appSource, /new URL\('\.\/api\/',document\.currentScript\.src\)/);
  assert.doesNotMatch(appSource, /fetch\('\/api\//);
  for (const endpoint of ['settings', 'ai/status', 'ai', 'ai/free', 'ai/tools/names', 'content', 'art-assets', 'images/status', 'images/generate', 'images/compose-prompt', 'images/optimize-prompt']) {
    assert.match(appSource, new RegExp(`fetch\\(apiUrl\\('${endpoint.replace('/', '\\/')}'\\)`));
  }
  assert.match(htmlSource, /app\.js\?v=21/);
  assert.match(htmlSource, /styles\.css\?v=15/);
  assert.match(htmlSource, /cards\.js\?v=1/);
  assert.match(htmlSource, /geography\.js\?v=2/);
  assert.match(htmlSource, /chronicle\.js\?v=1/);
});

test('AI candidates can be applied to the current form and the free workspace is styled', () => {
  assert.match(appSource, /function applyAiVariant\(index\)/);
  assert.match(appSource, /应用到当前表单/);
  assert.match(appSource, /候选内容已覆盖到当前表单，请确认后保存/);
  assert.match(styleSource, /\.free-context-body/);
  assert.match(styleSource, /\.ai-apply-button/);
});

test('extensionless mount paths gain a trailing slash before assets load', () => {
  assert.match(htmlSource, /pageSegment && !pageSegment\.includes\('\.'\)/);
  assert.match(htmlSource, /location\.replace\(`\$\{location\.pathname\}\/\$\{location\.search\}\$\{location\.hash\}`\)/);
});
