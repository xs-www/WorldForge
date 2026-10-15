import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
const macroSource = await readFile(new URL('../dist/macro.js', import.meta.url), 'utf8');

test('browser API requests follow the script mount path', () => {
  assert.match(appSource, /new URL\('\.\/api\/',document\.currentScript\.src\)/);
  assert.doesNotMatch(appSource, /fetch\('\/api\//);
  for (const endpoint of ['settings', 'ai/status', 'ai', 'ai/free', 'ai/tools/names', 'content', 'art-assets', 'images/status', 'images/generate', 'images/compose-prompt', 'images/optimize-prompt', 'simulation', 'simulation/advance', 'simulation/run', 'simulation/reset']) {
    assert.match(appSource, new RegExp(`fetch\\(apiUrl\\('${endpoint.replace('/', '\\/')}'\\)`));
  }
  assert.match(htmlSource, /app\.js\?v=26/);
  assert.match(htmlSource, /macro\.js\?v=3/);
  assert.match(htmlSource, /styles\.css\?v=20/);
  assert.match(htmlSource, /cards\.js\?v=1/);
  assert.match(htmlSource, /geography\.js\?v=2/);
  assert.match(htmlSource, /chronicle\.js\?v=1/);
});

test('macro simulator exposes a map-first UI and subpath-safe local proposal flow', () => {
  assert.match(htmlSource, /id="macroMap"/);
  assert.match(htmlSource, /id="macroAskLlm"/);
  assert.match(htmlSource, /开发诊断：W99 Action \/ Knowledge \/ Replay/);
  assert.match(macroSource, /const scriptRoot=new URL\('\.',document\.currentScript\.src\)/);
  for (const endpoint of ['macro/step', 'macro/run', 'macro/reset', 'macro/local-proposal']) assert.match(macroSource, new RegExp(`post\\('${endpoint.replace('/', '\\/')}'`));
  assert.match(styleSource, /\.macro-map/);
  assert.match(styleSource, /\.macro-local-panel/);
});

test('simulation dashboard exposes state, actor knowledge, audits, and controlled actions', () => {
  assert.match(htmlSource, /data-module="simulation"/);
  assert.match(htmlSource, /id="simulationModule"/);
  assert.match(htmlSource, /data-simulation-preset="conflict"/);
  assert.match(htmlSource, /id="runFullSimulation"/);
  assert.match(htmlSource, /id="resetSimulation"/);
  assert.match(appSource, /function renderSimulation\(\)/);
  assert.match(appSource, /X-Worldforge-Simulation/);
  assert.match(styleSource, /\.simulation-grid/);
  assert.match(styleSource, /\.simulation-knowledge/);
});

test('AI candidates can be applied and invalid model output remains inspectable', () => {
  assert.match(appSource, /function applyAiVariant\(index\)/);
  assert.match(appSource, /function renderAiDiagnostics\(diagnostics\)/);
  assert.match(appSource, /应用到当前表单/);
  assert.match(appSource, /查看模型原始片段/);
  assert.match(appSource, /候选内容已覆盖到当前表单，请确认后保存/);
  assert.match(styleSource, /\.free-context-body/);
  assert.match(styleSource, /\.ai-apply-button/);
  assert.match(styleSource, /\.ai-diagnostics/);
});

test('image generation handles empty responses without repeating a paid request', () => {
  assert.match(appSource, /function readApiJson\(response,label='请求失败'\)/);
  assert.match(appSource, /function requestGeneratedAsset\(payload\)/);
  assert.match(appSource, /recoverGeneratedAsset\(clientRequestId\)/);
  assert.match(appSource, /未自动重试付费生成/);
  assert.match(appSource, /clientRequestId/);
});

test('extensionless mount paths gain a trailing slash before assets load', () => {
  assert.match(htmlSource, /pageSegment && !pageSegment\.includes\('\.'\)/);
  assert.match(htmlSource, /location\.replace\(`\$\{location\.pathname\}\/\$\{location\.search\}\$\{location\.hash\}`\)/);
});
