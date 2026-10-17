import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8');
const macroSource = await readFile(new URL('../dist/macro.js', import.meta.url), 'utf8');
const battleSource = await readFile(new URL('../dist/battle.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const harnessSource = await readFile(new URL('../ai-harness.mjs', import.meta.url), 'utf8');

test('browser API requests follow the script mount path', () => {
  assert.match(appSource, /new URL\('\.\/api\/',document\.currentScript\.src\)/);
  assert.doesNotMatch(appSource, /fetch\('\/api\//);
  for (const endpoint of ['settings', 'ai/status', 'ai', 'ai/free', 'ai/tools/names', 'content', 'art-assets', 'images/status', 'images/generate', 'images/compose-prompt', 'images/optimize-prompt', 'simulation', 'simulation/advance', 'simulation/run', 'simulation/reset']) {
    assert.match(appSource, new RegExp(`fetch\\(apiUrl\\('${endpoint.replace('/', '\\/')}'\\)`));
  }
  assert.match(htmlSource, /app\.js\?v=49/);
  assert.match(htmlSource, /macro\.js\?v=3/);
  assert.match(htmlSource, /styles\.css\?v=38/);
  assert.match(htmlSource, /cards\.js\?v=6/);
  assert.match(htmlSource, /world-scope\.js\?v=1/);
  assert.match(htmlSource, /relation-picker\.js\?v=1/);
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

test('experimental card battle exposes controlled keywords and a local battle surface', () => {
  assert.match(htmlSource, /data-module="battle"/);
  assert.match(htmlSource, /id="battleModule"/);
  assert.match(htmlSource, /id="battleEndTurn"/);
  assert.match(htmlSource, /battle\.js\?v=1/);
  assert.match(battleSource, /KEY-001/);
  assert.match(battleSource, /maxResolutionSteps:32/);
  assert.doesNotMatch(battleSource, /\beval\s*\(/);
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

test('minion tribe and spell school share the bottom slot of the card face', () => {
  assert.match(htmlSource, /id="cardSubtype"/);
  assert.match(htmlSource, /id="cardSubtypeLabel">种族</);
  assert.match(htmlSource, /id="cardSubtypeLine"/);
  assert.doesNotMatch(htmlSource, /cardTribeLine|cardSchoolLine/);
  assert.match(appSource, /function renderCardSubtype\(type,pending\)/);
  assert.match(appSource, /function updateCardSubtypeLines\(type,value\)/);
  assert.match(appSource, /function drawCardSubtype\(ctx,card\)/);
  assert.match(appSource, /ctx\.fillText\(text,330,826\)/);
  assert.match(appSource, /WorldforgeCards\.schoolTierLabels\[tier\]/);
  assert.match(appSource, /tribeId:type==='minion'\?q\('#cardSubtype'\)\.value:''/);
  assert.match(appSource, /spellSchoolId:type==='spell'\?q\('#cardSubtype'\)\.value:''/);
  assert.match(styleSource, /\.card-subtype-line\{position:absolute;left:78px;right:78px;bottom:37px/);
  assert.match(styleSource, /#cardSubtypeLabel\[hidden\],#cardSubtype\[hidden\]\{display:none\}/);
});

test('editor preview mirrors the compiled card geometry at half scale', () => {
  assert.match(appSource, /\{x:115,y:88,width:430,height:410,radius:205\}/);
  assert.match(appSource, /\{x:75,y:105,width:510,height:380,radius:28\}/);
  assert.match(appSource, /\{x:150,y:105,width:360,height:360,radius:180\}/);
  assert.match(appSource, /roundedPath\(ctx,76,464,508,74,24\)/);
  assert.match(appSource, /roundedPath\(ctx,78,548,504,242,22\)/);
  const art={minion:[115,88,410],spell:[75,105,380],equipment:[150,105,360]};
  for (const [type,[x,y,height]] of Object.entries(art)) {
    assert.match(styleSource,new RegExp(`\\.editable-card\\[data-card-type="${type}"\\] \\.card-art-placeholder\\{left:${x/2}px;right:${x/2}px;top:${y/2}px;height:${height/2}px`));
  }
  assert.match(styleSource, /\.card-name-field\{top:232px;left:38px;right:38px;height:37px/);
  assert.match(styleSource, /\.card-description-field\{left:39px;right:39px;top:274px;bottom:65px/);
  assert.match(styleSource, /\.cost-stat\{left:15px;top:14px\}/);
  assert.match(styleSource, /\.attack-stat\{left:22px;bottom:23px\}/);
  assert.match(styleSource, /\.health-stat\{right:22px;bottom:23px\}/);
  assert.match(styleSource, /\.card-stat\{width:48px;height:48px\}/);
});

test('worldview module is a world list that scopes every entry to one world', () => {
  assert.match(htmlSource, /id="worldHub"/);
  assert.match(htmlSource, /id="worldDetail" hidden/);
  assert.match(htmlSource, /id="worldGrid"/);
  assert.match(htmlSource, /id="worldSearch"/);
  assert.match(htmlSource, /id="newWorld"/);
  assert.match(htmlSource, /id="backToWorlds"/);
  assert.match(htmlSource, /id="worldDetailTitle"/);
  assert.match(htmlSource, /id="loreWorldIdText"/);
  assert.doesNotMatch(htmlSource, /id="loreWorldId"/);
  assert.match(appSource, /let activeWorldId=''/);
  assert.match(appSource, /function currentWorldId\(\)/);
  assert.match(appSource, /function enterWorld\(worldId\)/);
  assert.match(appSource, /function leaveWorld\(\)/);
  assert.match(appSource, /function renderWorldHub\(\)/);
  assert.match(appSource, /function createWorld\(\)/);
  assert.match(appSource, /function adoptWorldGroup\(sourceId,targetId\)/);
  assert.match(appSource, /WorldforgeWorldScope\.loreOfWorld\(readLore\(\),activeWorldId\)/);
  assert.match(appSource, /worldId:currentWorldId\(\)/);
  assert.match(appSource, /if\(m==='world'\)leaveWorld\(\)/);
  assert.doesNotMatch(appSource, /q\('#loreWorldId'\)/);
  assert.match(styleSource, /\.world-grid\{/);
  assert.match(styleSource, /\.world-hub\[hidden\],\.world-detail\[hidden\]\{display:none\}/);
  assert.match(styleSource, /\.field-readonly\{/);
});

test('one picker window serves lore relations, card sources and free-agent references', () => {
  // 三处多选控件都被同一个选择窗口取代，不再有裸 select multiple。
  assert.doesNotMatch(htmlSource, /id="loreRelations"/);
  assert.doesNotMatch(htmlSource, /id="cardLoreRefs"/);
  assert.doesNotMatch(appSource, /q\('#loreRelations'\)/);
  assert.doesNotMatch(appSource, /q\('#cardLoreRefs'\)/);
  assert.match(htmlSource, /id="relationDialog"/);
  assert.match(htmlSource, /id="relationDialogEyebrow"/);
  assert.match(htmlSource, /id="relationDialogTitle"/);
  assert.match(htmlSource, /id="relationSearch"/);
  assert.match(htmlSource, /id="relationTypeFilter"/);
  assert.match(htmlSource, /id="relationWorldFilter"/);
  assert.match(htmlSource, /id="relationStatusFilter"/);
  assert.match(htmlSource, /id="relationViewFilter"/);
  assert.match(htmlSource, /id="relationPoolList"/);
  assert.match(htmlSource, /id="relationChosenList"/);
  assert.match(htmlSource, /id="applyRelations"/);
  // 每个目标都有自己的已选区与打开按钮
  assert.match(htmlSource, /id="relationSummary"/);
  assert.match(htmlSource, /id="openRelationPicker"/);
  assert.match(htmlSource, /id="cardLoreRefSummary"/);
  assert.match(htmlSource, /id="openCardLoreRefPicker"/);
  assert.match(htmlSource, /id="freeRefSummary"/);
  assert.match(htmlSource, /id="openFreeRefPicker"/);
  assert.match(appSource, /const pickerTargets=\{/);
  for (const key of ['lore', 'card', 'free']) assert.match(appSource, new RegExp(`\\n  ${key}:\\{title:`));
  assert.match(appSource, /function openPicker\(key\)/);
  assert.match(appSource, /function renderPicker\(\)/);
  assert.match(appSource, /function applyPicker\(\)/);
  assert.match(appSource, /function renderPickerSummaries\(\)/);
  assert.match(appSource, /function populateCardLoreRefs\(selected=\[\]\)\{cardLoreSelection=normalizeSelection\(selected\)/);
  assert.match(appSource, /relationIds:\[\.\.\.relationSelection\]/);
  assert.match(appSource, /loreRefs:selectedCardLoreRefs\(\)/);
  assert.match(appSource, /wholeLibrary=!picked\.length&&q\('#freeIncludeLibrary'\)\.checked,granted=picked\.length\?picked:\(wholeLibrary\?readLore\(\):\[\]\)/);
  assert.match(appSource, /library:granted/);
  assert.match(appSource, /WorldforgeRelationPicker\.filter\(all,\{\.\.\.pickerFilters\(\),excludeId:exclude,selectedIds:pickerDraft\}\)/);
  assert.match(appSource, /WorldforgeRelationPicker\.toggle\(pickerDraft,entry\.id\)/);
  assert.match(appSource, /q\('#openCardLoreRefPicker'\)\.onclick=\(\)=>openPicker\('card'\)/);
  assert.match(appSource, /q\('#openFreeRefPicker'\)\.onclick=\(\)=>openPicker\('free'\)/);
  assert.match(styleSource, /\.relation-picker\{/);
  assert.match(styleSource, /\.relation-row\.chosen\{/);
});

test('bulk form fill only writes ids that exist in the markup', () => {
  // loadLore 与 fillLoreForm 都用「id → 值」映射表写表单；映射表里的键必须是真实存在的元素 id，
  // 否则 q() 返回 null，赋值会抛错并让整个动作失效。
  const mapKeysOf = (fnName) => {
    const start = appSource.indexOf(`function ${fnName}(`);
    assert.ok(start > -1, `${fnName} should exist`);
    const body = appSource.slice(start);
    const mapStart = body.indexOf('const values={') + 'const values={'.length;
    const mapEnd = body.indexOf('};Object.entries(values)');
    assert.ok(mapStart > 0 && mapEnd > mapStart, `${fnName} should build a key/value map`);
    return [...body.slice(mapStart, mapEnd).matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map(match => match[1]);
  };
  for (const fnName of ['loadLore', 'fillLoreForm']) {
    const keys = mapKeysOf(fnName);
    assert.ok(keys.length >= 15, `${fnName} should expose keys, got ${keys.length}`);
    assert.deepEqual(keys.filter(key => !htmlSource.includes(`id="${key}"`)), [], `${fnName} writes unknown ids`);
  }
});

test('the free agent reaches lore and art through read-only server-side tools', () => {
  assert.match(serverSource, /import \{ AGENT_LIMITS, FREE_AGENT_TOOLS, prepareArtAssets, prepareLibrary, runToolCall \} from '\.\/ai-tools\.mjs'/);
  assert.match(serverSource, /import \{ createToolCaller, runAgentLoop \} from '\.\/ai-agent\.mjs'/);
  assert.match(harnessSource, /export const FREE_AGENT_TOOL_GUIDE/);
  assert.match(serverSource, /FREE_AGENT_TOOL_GUIDE/);
  assert.match(serverSource, /const library = prepareLibrary\(payload\?\.library\)/);
  assert.match(serverSource, /const artAssets = prepareArtAssets\(payload\?\.artAssets\)/);
  assert.match(serverSource, /callModel: callModelFor\(useTools\)/);
  assert.match(serverSource, /runToolCall\(name, args, library, artAssets\)/);
  assert.match(serverSource, /async function resolveAgentImages\(value, maximum = AGENT_LIMITS\.maxImages\)/);
  assert.match(serverSource, /outcome\.images = resolved\.images/);
  assert.match(serverSource, /const useTools = available && policyTools\.length > 0/);
  // 美术资产必须能被真正看到，而不是只给元数据
  assert.match(harnessSource, /get_art_asset：按资产编号把 1–4 张原画的实际画面附到本次对话/);
  assert.match(harnessSource, /必须先用 get_art_asset 把图附上来/);
  // 三种模式都要如实回报，方便前端说明当前是工具检索还是退回单轮
  assert.match(serverSource, /describe\(result, useTools \? 'native' : 'none'\)/);
  assert.match(serverSource, /describe\(result, 'unavailable'\)/);
  assert.match(serverSource, /vision: result\.vision, images: attachedCount \+ result\.images/);
  assert.match(serverSource, /if \(!\[400, 404, 422\]\.includes\(error\.status\)\) throw error;/);
  // 旧的“客户端开关决定是否附带索引”不再由服务端判断
  assert.doesNotMatch(serverSource, /payload\?\.includeLibrary/);
  assert.match(appSource, /function freeAgentMeta\(message\)/);
  assert.match(appSource, /freeMessages\.map\(item=>\(\{role:item\.role,content:item\.content,/);
  assert.match(appSource, /artAssets:grantedArt/);
  assert.match(appSource, /grantedArt=granted\.length\?artAssets\.slice\(0,200\)/);
  assert.match(appSource, /data\.trace/);
  assert.match(styleSource, /\.free-trace\{/);
  assert.match(htmlSource, /允许 Agent 检索整个资料库/);
});

test('each free-chat turn snapshots the reference material it was sent with', () => {
  // 每条用户消息在发送时快照当时的参考资料，之后改选择不会回溯改写历史消息。
  assert.match(appSource, /function freeContextSnapshot\(picked,wholeLibrary,total,artCount\)/);
  assert.match(appSource, /function freeContextPreview\(message\)/);
  assert.match(appSource, /context:freeContextSnapshot\(picked,wholeLibrary,granted\.length,grantedArt\.length\)/);
  assert.match(appSource, /else\{const preview=freeContextPreview\(message\);if\(preview\)item\.append\(preview\)\}/);
  assert.match(appSource, /chip\.className='free-context-chip'/);
  assert.match(appSource, /art\.className='free-context-chip art'/);
  assert.match(appSource, /free-context-chip more/);
  assert.match(styleSource, /\.free-context-preview\{/);
  assert.match(styleSource, /\.free-context-chip\.art\{/);
  // 快照只留在本地消息上，不随请求发回服务端
  assert.match(appSource, /freeMessages\.map\(item=>\(\{role:item\.role,content:item\.content/);
});

test('the free chat can attach images picked from the asset library', () => {
  assert.match(appSource, /const FREE_ATTACH_LIMIT=4/);
  assert.match(appSource, /let freeAttachmentIds=\[\]/);
  assert.match(appSource, /function renderFreeAttachments\(\)/);
  assert.match(appSource, /function toggleFreeAttachment\(id\)/);
  assert.match(appSource, /一条消息最多附加/);
  // 附件挂在用户消息上，只发资产编号；发送后清空
  assert.match(appSource, /assets:\[\.\.\.freeAttachmentIds\]/);
  assert.match(appSource, /\.\.\.\(item\.assets\?\.length\?\{assets:item\.assets\}:\{\}\)/);
  assert.match(appSource, /freeAttachmentIds=\[\];renderFreeAttachments\(\)/);
  assert.match(appSource, /renderFreeAttachments\(\)\};/);
  assert.match(htmlSource, /id="freeAttachTray"/);
  assert.match(htmlSource, /id="freeAttachSearch"/);
  assert.match(htmlSource, /id="freeAttachCount"/);
  assert.match(htmlSource, /id="freeAttachEmpty"/);
  assert.match(styleSource, /\.free-attach-tray\{/);
  assert.match(styleSource, /\.free-attach-item\.selected\{/);
  assert.match(styleSource, /\.free-attach-thumb\{/);
  assert.match(styleSource, /\.free-context-row\{/);
  // 服务端按编号把附件读成图片，且无工具路径也保留附图
  assert.match(serverSource, /const assets = role === 'user' && Array\.isArray\(item\?\.assets\)/);
  assert.match(serverSource, /const attached = await resolveAgentImages\(assets, AGENT_LIMITS\.maxImages\)/);
  assert.match(serverSource, /const useTools = available && policyTools\.length > 0/);
  assert.match(serverSource, /maxRounds: useTools \? undefined : 1/);
  assert.doesNotMatch(serverSource, /transcriptOf/);
});

test('AI assistant is a minimizable dock, candidates can overwrite, bindings can be released', () => {
  // AI 助手改成浮动子窗口，可最小化成侧边竖条，也可关闭后从边缘重开
  assert.match(htmlSource, /id="aiPanel" data-state="open"/);
  assert.match(htmlSource, /id="minimizeAi"/);
  assert.match(htmlSource, /id="closeAi"/);
  assert.match(htmlSource, /id="openAiPanel"/);
  assert.match(appSource, /const UI_KEY='worldforge-ui-state-v1'/);
  assert.match(appSource, /function setAiPanel\(state\)/);
  assert.match(appSource, /function applyAiPanel\(\)/);
  assert.match(appSource, /panel\.onclick=state==='min'\?\(\)=>setAiPanel\('open'\):null/);
  assert.match(appSource, /updateLoreVisualState\(\);applyAiPanel\(\)\}bootstrap\(\)/);
  assert.match(styleSource, /\.ai-panel\{position:fixed;top:64px;right:0;bottom:0;width:368px/);
  assert.match(styleSource, /\.ai-panel\[data-state="min"\]\{width:46px/);
  assert.match(styleSource, /\.ai-panel\[data-state="closed"\]\{display:none\}/);
  assert.match(styleSource, /\.ai-reopen\{position:fixed/);
  // 候选可以只生成 1 份，并且可以一步覆盖当前条目
  assert.match(htmlSource, /<option value="1">1 份<\/option>/);
  assert.match(serverSource, /const expectedCount = Math\.min\(5, Math\.max\(1, Number\(payload\?\.variantCount\) \|\| 3\)\)/);
  assert.match(appSource, /function overwriteWithAiVariant\(index\)/);
  assert.match(appSource, /overwrite\.textContent='覆盖当前条目'/);
  assert.match(appSource, /applyAiVariant\(index\);saveLore\(\)/);
  // 卡牌原画可以取消选择；设定画作可以解除绑定且图片留在素材库
  assert.match(htmlSource, /id="clearCardArt"/);
  assert.match(appSource, /function clearCardArt\(\)/);
  assert.match(appSource, /function unbindArtAsset\(asset\)/);
  assert.match(appSource, /art-assets\/\$\{encodeURIComponent\(asset\.id\)\}\/unbind/);
  assert.match(appSource, /unbound:true,targetType:'',targetId:'',cardId:''/);
  assert.match(serverSource, /const artUnbindMatch = pathname\.match/);
  assert.match(serverSource, /contentStore\.setArtAssetTarget\(artUnbindMatch\[1\], null\)/);
  assert.match(styleSource, /\.art-unbind\{/);
});

test('artwork gallery covers the whole asset library with a used/unused filter', () => {
  assert.match(htmlSource, /id="artworkFilter"/);
  assert.match(htmlSource, /<option value="used">已使用原画<\/option>/);
  assert.match(htmlSource, /<option value="unused">未使用原画<\/option>/);
  assert.match(htmlSource, /id="artworkEmptyTitle"/);
  assert.match(appSource, /let artworkFilter='used'/);
  assert.match(appSource, /function artworkEntries\(\)/);
  assert.match(appSource, /artAssets\.filter\(asset=>asset\.provenance!=='user_reference'\)/);
  assert.match(appSource, /q\('#artworkFilter'\)\.onchange/);
  assert.match(appSource, /artwork-item\$\{entry\.used\?'':' unused'\}/);
  assert.match(styleSource, /\.artwork-item\.unused\{/);
  assert.match(styleSource, /\.artwork-toolbar\{/);
});
