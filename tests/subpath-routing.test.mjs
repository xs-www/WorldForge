import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
const macroSource = await readFile(new URL('../dist/macro.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('browser API requests follow the script mount path', () => {
  assert.match(appSource, /new URL\('\.\/api\/',document\.currentScript\.src\)/);
  assert.doesNotMatch(appSource, /fetch\('\/api\//);
  for (const endpoint of ['settings', 'ai/status', 'ai', 'ai/free', 'ai/tools/names', 'content', 'art-assets', 'images/status', 'images/generate', 'images/compose-prompt', 'images/optimize-prompt', 'simulation', 'simulation/advance', 'simulation/run', 'simulation/reset']) {
    assert.match(appSource, new RegExp(`fetch\\(apiUrl\\('${endpoint.replace('/', '\\/')}'\\)`));
  }
  assert.match(htmlSource, /app\.js\?v=33/);
  assert.match(htmlSource, /macro\.js\?v=3/);
  assert.match(htmlSource, /styles\.css\?v=27/);
  assert.match(htmlSource, /cards\.js\?v=6/);
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
  assert.match(appSource, /function unbindCardFromLore\(cardId\)/);
  assert.match(appSource, /referenceAssetIds:\[\.\.\.loreReferenceAssetIds\]/);
  assert.match(htmlSource, /id="aiVisionReferenceAssets"/);
});

test('image generation handles empty responses without repeating a paid request', () => {
  assert.match(appSource, /function readApiJson\(response,label='请求失败'\)/);
  assert.match(appSource, /function requestGeneratedAsset\(payload\)/);
  assert.match(appSource, /recoverGeneratedAsset\(clientRequestId\)/);
  assert.match(appSource, /未自动重试付费生成/);
  assert.match(appSource, /clientRequestId/);
});

test('artwork download names files after the stable asset id', () => {
  assert.match(serverSource, /'Content-Disposition': `attachment; filename="\$\{asset\.id\}\.\$\{extension\}"`/);
  assert.match(serverSource, /requestUrl\.searchParams\.get\('download'\) === '1'/);
  assert.match(appSource, /download\.download=`\$\{asset\.id\}\.\$\{extension\}`/);
});

test('extensionless mount paths gain a trailing slash before assets load', () => {
  assert.match(htmlSource, /pageSegment && !pageSegment\.includes\('\.'\)/);
  assert.match(htmlSource, /location\.replace\(`\$\{location\.pathname\}\/\$\{location\.search\}\$\{location\.hash\}`\)/);
});

test('card library, artwork, and editor stay independent', () => {
  assert.match(htmlSource, /data-card-tab="library"/);
  assert.match(htmlSource, /data-card-panel="artwork" hidden/);
  assert.match(htmlSource, /data-card-panel="editor" hidden/);
  assert.match(htmlSource, /id="cardLibraryType"/);
  assert.match(htmlSource, /id="cardLibraryRarity"/);
  assert.match(htmlSource, /id="cardPagePrev"/);
  assert.match(htmlSource, /id="cardPageNext"/);
  assert.match(htmlSource, /id="cardSecondaryLabel"/);
  assert.match(styleSource, /\.card-workspace\[hidden\]\{display:none\}/);
  assert.match(appSource, /function switchCardTab\(tab\)/);
  assert.match(appSource, /WorldforgeCards\.compileDescription/);
  assert.match(appSource, /async function compileCardPng\(card,map=keywordMap\(\)\)/);
  assert.match(appSource, /function bindCardArtGestures\(\)/);
  assert.match(appSource, /cardPngCache\.set\(c\.id,await compileCardPng/);
  assert.match(htmlSource, /id="imageViewerDownload"/);
  assert.match(appSource, /canvasTextFont\(fontSize,glyph\.bold,glyph\.italic\)/);
  assert.match(appSource, /document\.createElement\('span'\)/);
  assert.doesNotMatch(appSource, /ctx\.fillText\(label,x,y\+69\)/);
  assert.match(styleSource, /\.card-stat span\{display:none\}/);
  assert.match(styleSource, /\.compiled-inline\.italic\{font-style:italic\}/);
});

test('minion tribe and spell school render on the card face per type', () => {
  assert.match(htmlSource, /id="cardSubtype"/);
  assert.match(htmlSource, /id="cardSubtypeLabel">种族</);
  assert.match(htmlSource, /id="cardTribeLine"/);
  assert.match(htmlSource, /id="cardSchoolLine"/);
  assert.match(appSource, /function renderCardSubtype\(type,pending\)/);
  assert.match(appSource, /function updateCardSubtypeLines\(type,value\)/);
  assert.match(appSource, /function drawCardName\(ctx,card\)/);
  assert.match(appSource, /function drawCardSchool\(ctx,card\)/);
  assert.match(appSource, /WorldforgeCards\.schoolTierLabels\[tier\]/);
  assert.match(appSource, /tribeId:type==='minion'\?q\('#cardSubtype'\)\.value:''/);
  assert.match(appSource, /spellSchoolId:type==='spell'\?q\('#cardSubtype'\)\.value:''/);
  assert.match(appSource, /WorldforgeCards\.subtypeText\(c\)/);
  assert.match(styleSource, /\.card-subtype-line\{/);
  assert.match(styleSource, /\.card-school-line\{/);
  assert.match(styleSource, /#cardSubtypeLabel\[hidden\],#cardSubtype\[hidden\]\{display:none\}/);
});
