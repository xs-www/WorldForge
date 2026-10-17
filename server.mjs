import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUntrustedContext, buildContextBundle, buildPrompt, buildSupplementPrompt, completeAiVariants, composeAgentSystemPrompt, createLoreResponseSchema, createModelBody, FREE_AGENT_TOOL_GUIDE, FREE_ENTRY_CONTRACT, HARNESS_VERSION, LORE_ENTRY_CONTRACT, NAME_RESPONSE_SCHEMA, parseNameResponse } from './ai-harness.mjs';
import { AGENT_LIMITS, FREE_AGENT_TOOLS, prepareArtAssets, prepareLibrary, runToolCall } from './ai-tools.mjs';
import { createToolCaller, runAgentLoop } from './ai-agent.mjs';
import { comfyUiConfig, generateComfyUiImage, validateComfyUiSettings } from './comfyui.mjs';
import { createContentStore } from './storage.mjs';
import { composeImagePrompt } from './image-context.mjs';
import { generateSeedreamImage, seedreamConfig, validateImageRequest, validateSeedreamSettings } from './seedream.mjs';
import { normalizeReferenceAssetIds, parseReferenceUpload, toReferenceDataUrl } from './reference-assets.mjs';
import { DEFAULT_IMAGE_PROMPTS, DEFAULT_TYPE_PROMPTS, DEFAULT_VISUAL_STYLE_PROMPT, normalizePromptSettings, validatePromptSettings } from './prompt-settings.mjs';
import { asAgentProfileError, loadAgentProfiles, publicRegistryView, registryHealthSummary } from './agent-profile-registry.mjs';
import { createSimulationDashboardService } from './simulation/dashboard-service.mjs';
import { createMacroSimulationService } from './simulation/macro-simulation-service.mjs';
import { buildMacroProposalPrompt, MACRO_PROPOSAL_SCHEMA } from './simulation/llm/macro-proposal.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');
const envPath = process.env.WORLDFORGE_CONFIG_PATH || join(root, '.env.local');
const comfyWorkflowPath = process.env.WORLDFORGE_COMFY_WORKFLOW_PATH || join(dirname(envPath), 'comfyui-workflow.json');
const promptSettingsPath = process.env.WORLDFORGE_PROMPT_SETTINGS_PATH || join(dirname(envPath), 'prompt-settings.json');

async function loadLocalEnv() {
  try {
    const source = await readFile(envPath, 'utf8');
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('无法读取 .env.local:', error.message); }
}
await loadLocalEnv();
const databasePath = process.env.WORLDFORGE_DB_PATH || join(root, '.data', 'worldforge.sqlite');
const assetsPath = process.env.WORLDFORGE_ASSETS_PATH || join(dirname(databasePath), 'assets', 'cards');
const contentStore = createContentStore(databasePath);
const simulationDatabasePath = process.env.WORLDFORGE_SIM_DB_PATH || join(dirname(databasePath), 'worldforge-simulation.sqlite');
const simulationDashboard = createSimulationDashboardService(simulationDatabasePath);
const macroSimulation = createMacroSimulationService(simulationDatabasePath);
await mkdir(assetsPath, { recursive: true });

// Agent Profile Registry：启动时一次性加载并冻结，请求期间不再读取磁盘，
// 因此不会读到半写入文件。任何无效、损坏或不兼容的 preset 都会拒绝启动并打印
// 稳定错误码，而不是跳过或静默换用其他 persona（ADR-0029 §9、计划 §12.1）。
let agentProfiles;
try {
  agentProfiles = await loadAgentProfiles();
  const summary = registryHealthSummary(agentProfiles);
  console.log(`[agent-profiles] loaded ${summary.count} preset(s): ${summary.ids.join(', ')}`);
} catch (error) {
  const failure = asAgentProfileError(error);
  console.error(`[agent-profiles] ${failure.code}: ${failure.message}`);
  for (const detail of failure.details) console.error(`[agent-profiles]   - ${detail}`);
  console.error('[agent-profiles] 拒绝启动：请修复或移除损坏的 preset 投影后重试。产品不会自动改用其他 persona。');
  // 必须显式退出：数据库与模拟服务在启动阶段已经打开，仅 throw 会让事件循环保持存活，
  // 容器会表现为"启动失败但不退出"，本机也会留下锁定的 SQLite 文件。
  process.exit(1);
}

async function saveLocalEnv(values) {
  let source = '';
  try { source = await readFile(envPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pending = new Map(Object.entries(values));
  const managed = new Set(pending.keys());
  const output = [];
  for (const line of source.split(/\r?\n/).filter((item, index, all) => index < all.length - 1 || item)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !managed.has(match[1])) { output.push(line); continue; }
    if (pending.has(match[1])) { output.push(`${match[1]}=${pending.get(match[1])}`); pending.delete(match[1]); }
  }
  for (const [key, value] of pending) output.push(`${key}=${value}`);
  await mkdir(dirname(envPath), { recursive: true });
  const temporary = `${envPath}.tmp`;
  await writeFile(temporary, `${output.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, envPath);
  Object.assign(process.env, values);
}

const port = Number(process.env.PORT || 8080);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
function json(res, status, value) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }

async function readBody(req, maxLength = 2000000) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > maxLength) throw new Error('请求内容过长'); }
  return JSON.parse(body || '{}');
}

function aiConfig() {
  return { key: process.env.LLM_API_KEY || '', baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''), model: process.env.LLM_MODEL || 'gpt-5-mini', style: process.env.LLM_API_STYLE === 'chat' ? 'chat' : 'responses' };
}

function validateSettings(payload) {
  const baseUrl = String(payload.baseUrl || '').trim();
  const model = String(payload.model || '').trim();
  const style = payload.style === 'chat' ? 'chat' : 'responses';
  const apiKey = payload.clearApiKey ? '' : (payload.apiKey === undefined ? undefined : String(payload.apiKey).trim());
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl) || baseUrl.length > 500) throw new Error('Base URL 必须是有效的 HTTP(S) 地址');
  if (!model || model.length > 120 || /[\r\n]/.test(model)) throw new Error('模型名称无效');
  if (apiKey !== undefined && (apiKey.length > 500 || /[\r\n]/.test(apiKey))) throw new Error('API Key 无效');
  return { baseUrl: baseUrl.replace(/\/$/, ''), model, style, apiKey, seedream: validateSeedreamSettings(payload), comfyUi: validateComfyUiSettings(payload), prompts: payload.promptSettings === undefined ? undefined : validatePromptSettings(payload.promptSettings) };
}

async function loadComfyWorkflow() {
  try { return JSON.parse(await readFile(comfyWorkflowPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`无法读取 ComfyUI 工作流：${error.message}`); }
}

async function saveComfyWorkflow(workflow) {
  if (workflow === undefined) return;
  await mkdir(dirname(comfyWorkflowPath), { recursive: true });
  if (workflow === null) { await unlink(comfyWorkflowPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
  const temporary = `${comfyWorkflowPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, comfyWorkflowPath);
}

async function loadPromptSettings() {
  try { return normalizePromptSettings(JSON.parse(await readFile(promptSettingsPath, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return normalizePromptSettings(); throw new Error(`无法读取提示词设置：${error.message}`); }
}

async function savePromptSettings(settings) {
  if (settings === undefined) return;
  await mkdir(dirname(promptSettingsPath), { recursive: true });
  const temporary = `${promptSettingsPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, promptSettingsPath);
}

function imageExtension(mimeType) { return ({ 'image/png': '.png', 'image/webp': '.webp', 'image/jpeg': '.jpg' })[mimeType] || '.img'; }

async function createReferenceAsset(payload) {
  const upload = parseReferenceUpload(payload), id = `ART-${randomUUID().toUpperCase()}`;
  const fileName = `${id}${imageExtension(upload.mimeType)}`, file = join(assetsPath, fileName), temporary = `${file}.tmp`;
  await writeFile(temporary, upload.bytes, { mode: 0o600 });
  await rename(temporary, file);
  const asset={id,targetType:upload.targetType,targetId:upload.targetId,cardId:upload.targetType==='card'?upload.targetId:'',purpose:'reference',prompt:'用户上传参考图',model:'user-upload',size:'reference',mimeType:upload.mimeType,fileName,status:'proposed',provenance:'user_reference',provider:'local-upload',originalName:upload.originalName,createdAt:new Date().toISOString()};
  try{return contentStore.createArtAsset(asset)}catch(error){await unlink(file).catch(()=>{});throw error}
}

async function resolveReferenceImages(value, maximum = 10) {
  const ids=normalizeReferenceAssetIds(value).slice(0,maximum),images=[];
  for(const id of ids){const asset=contentStore.getArtAsset(id);if(!asset)throw new Error(`参考图不存在：${id}`);const file=join(assetsPath,asset.fileName);if(!file.startsWith(assetsPath))throw new Error('参考图路径无效');images.push(toReferenceDataUrl(asset,await readFile(file)))}
  return{ids,images};
}

// Agent 取图：单个编号失败不影响其余图片，失败项如实回报给模型。
async function resolveAgentImages(value, maximum = AGENT_LIMITS.maxImages) {
  const wanted = (Array.isArray(value) ? value : []).slice(0, maximum);
  const images = [], attached = [], missing = [];
  for (const raw of wanted) {
    const id = String(raw || '').trim();
    if (!/^ART-[A-Fa-f0-9-]+$/.test(id)) { missing.push(id || '(空编号)'); continue; }
    const asset = contentStore.getArtAsset(id);
    if (!asset) { missing.push(id); continue; }
    const file = join(assetsPath, asset.fileName);
    if (!file.startsWith(assetsPath)) { missing.push(id); continue; }
    try {
      images.push(toReferenceDataUrl(asset, await readFile(file)));
      attached.push(id);
    } catch {
      missing.push(id);
    }
  }
  return { images, attached, missing };
}

async function createArtAsset(payload) {
  const clientRequestId = String(payload?.clientRequestId || '').trim();
  if (clientRequestId && !/^[A-Za-z0-9-]{8,80}$/.test(clientRequestId)) throw new Error('图片请求 ID 无效');
  if (clientRequestId) {
    const existing = contentStore.listArtAssets().find(asset => asset.clientRequestId === clientRequestId);
    if (existing) return existing;
  }
  const composed=composeImagePrompt(payload,await loadPromptSettings());
  const references=await resolveReferenceImages(payload?.referenceAssetIds);
  const request = validateImageRequest({...payload,prompt:composed.prompt,referenceImages:references.images});
  const provider = payload.provider === 'comfyui' ? 'comfyui' : 'seedream';
  let generated, model, providerName;
  if (provider === 'comfyui') {
    if(references.ids.length)throw new Error('ComfyUI 当前工作流未配置参考图输入；请切换 Seedream 或取消参考图');
    const config = comfyUiConfig();
    generated = await generateComfyUiImage(config, await loadComfyWorkflow(), { ...request, negativePrompt: String(payload.negativePrompt || '').slice(0, 3000) });
    model = 'comfyui-workflow'; providerName = 'local-comfyui';
  } else {
    const config = seedreamConfig();
    generated = await generateSeedreamImage(config, request);
    model = config.model; providerName = 'volcengine-ark-seedream';
  }
  const id = `ART-${randomUUID().toUpperCase()}`;
  const fileName = `${id}${imageExtension(generated.mimeType)}`;
  const file = join(assetsPath, fileName);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, generated.bytes, { mode: 0o600 });
  await rename(temporary, file);
  const asset = {
    id,
    targetType:generated.request.targetType,
    targetId:generated.request.targetId,
    cardId:generated.request.cardId,
    purpose:generated.request.purpose,
    prompt: generated.request.prompt,
    promptKey:composed.key,
    contextIds:composed.contextIds,
    referenceAssetIds:references.ids,
    model,
    size: generated.request.size,
    mimeType: generated.mimeType,
    fileName,
    status: 'proposed',
    provenance: 'ai_generated',
    provider: providerName,
    clientRequestId: clientRequestId || undefined,
    providerMetadata: generated.providerMetadata,
    createdAt: new Date().toISOString()
  };
  try { return contentStore.createArtAsset(asset); }
  catch (error) { await unlink(file).catch(() => {}); throw error; }
}

async function serveArtAsset(id, res, download = false) {
  const asset = contentStore.getArtAsset(id);
  if (!asset) return json(res, 404, { error: '美术资源不存在' });
  const file = join(assetsPath, asset.fileName);
  if (!file.startsWith(assetsPath)) return json(res, 403, { error: '禁止访问' });
  try {
    const content = await readFile(file);
    const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/webp' ? 'webp' : 'png';
    res.writeHead(200, { ...securityHeaders, 'Content-Type': asset.mimeType, 'Content-Length': content.length, 'Cache-Control': 'private, max-age=31536000, immutable', ...(download ? { 'Content-Disposition': `attachment; filename="${asset.id}.${extension}"` } : {}) });
    res.end(content);
  } catch (error) { if (error.code === 'ENOENT') return json(res, 404, { error: '美术文件不存在' }); throw error; }
}

async function requestModel(config, prompt, options = {}) {
  const endpoint = config.style === 'chat' ? `${config.baseUrl}/chat/completions` : `${config.baseUrl}/responses`;
  const body = createModelBody(config, prompt, options);
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `模型服务返回 ${response.status}`); error.status = response.status; throw error; }
  if (config.style === 'chat') return data.choices?.[0]?.message?.content || '';
  return data.output_text || data.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n') || '';
}

async function optimizeImagePrompt(payload) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置语言模型 API Key');
  const composed=composeImagePrompt(payload,await loadPromptSettings());
  const original = composed.prompt;
  const card = payload?.card && typeof payload.card === 'object' ? payload.card : {};
  const target=payload?.target&&typeof payload.target==='object'?payload.target:{};
  const instruction = `将下列世界观视觉原型或卡牌插画要求整理为一段可直接交给文生图模型的中文提示词。忠实保留已给设定与作者要求，强化主体、构图、环境、尺度、材质、色彩和光影；不要把模型补充细节写成确定事实。只能使用原创表达，不引入商业 IP 专有角色、地名、标志或画风模仿。不要生成卡框、文字、数字、Logo 或 UI。只返回优化后的提示词，不要解释。\n目标名称：${String(target.name||card.name||'').slice(0,100)}\n目标类型：${String(payload?.targetType==='lore'?target.type:card.type||'card').slice(0,40)}\n完整要求：${original}`;
  const endpoint = config.style === 'chat' ? `${config.baseUrl}/chat/completions` : `${config.baseUrl}/responses`;
  const body = config.style === 'chat'
    ? { model: config.model, messages: [{ role: 'system', content: '你是原创游戏卡牌插画提示词编辑器。' }, { role: 'user', content: instruction }] }
    : { model: config.model, instructions: '你是原创游戏卡牌插画提示词编辑器。', input: instruction };
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `语言模型返回 ${response.status}`);
  const optimized = String(config.style === 'chat' ? data.choices?.[0]?.message?.content : (data.output_text || data.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n')) || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '');
  if (!optimized || optimized.length > 5000) throw new Error('语言模型未返回有效提示词');
  return { prompt: optimized.slice(0, 3000), model: config.model, contextMeta:{promptKey:composed.key,contextIds:composed.contextIds,truncated:composed.truncated} };
}

// ── Agent Profile 解析（Sprint 2）────────────────────────────────────────────
// 不兼容、未知或缺失的 preset 必须在模型调用前失败，因此解析放在 requestModel 之前，
// 并把 AgentProfileError 统一映射为 400（不产生外部 token 与费用）。

function resolveSurfaceProfile(surface, presetId) {
  const requested = presetId === undefined || presetId === null || presetId === '' ? agentProfiles.defaults[surface] : String(presetId);
  try {
    return agentProfiles.resolve(requested, surface);
  } catch (error) {
    const failure = asAgentProfileError(error);
    failure.status = 400;
    throw failure;
  }
}

function agentSnapshot(profile) {
  return { presetId: profile.id, presetVersion: profile.version, presetHash: profile.hash, mode: profile.mode };
}

/** 工具策略只映射到服务端白名单；preset 不能扩大轮次/调用/附图硬上限。 */
function toolsForPolicy(profile) {
  if (profile.toolPolicy === 'free_lore_readonly') return FREE_AGENT_TOOLS;
  if (profile.toolPolicy === 'none') return [];
  const error = new Error(`工具策略 ${profile.toolPolicy} 尚未实现`);
  error.code = 'AGENT_PROFILE_INCOMPATIBLE';
  error.status = 400;
  throw error;
}

async function callAi(payload) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置 LLM_API_KEY');
  // 先解析 preset：不兼容或未知的 preset 在调用模型前就失败。
  const profile = resolveSurfaceProfile('lore', payload?.presetId);
  const agent = agentSnapshot(profile);
  const system = composeAgentSystemPrompt({ presetPrompt: profile.systemPrompt, entryContract: LORE_ENTRY_CONTRACT });
  const bundle = buildContextBundle(payload);
  const promptSettings = await loadPromptSettings();
  const prompt = buildPrompt({ ...payload, typePrompt: promptSettings.typePrompts[payload?.draft?.type] || '', personalizedPrompt: promptSettings.personalizedPrompt }, bundle);
  const validationPayload = { ...payload, allowedRelationIds: [...bundle.examples, ...bundle.entries].map(entry => entry.id) };
  const expectedCount = Math.min(5, Math.max(1, Number(payload?.variantCount) || 3));
  const schema = createLoreResponseSchema(payload);
  const vision=await resolveReferenceImages(payload?.referenceAssetIds,10);
  // 同一请求（含差额补生成）沿用同一 preset 快照，保证 system 与 hash 不漂移。
  const modelOptions={images:vision.images, system};
  let structured = true;
  let raw;
  try { raw = await requestModel(config, prompt, { structured: true, schema, payload, ...modelOptions }); }
  catch (error) {
    if (![400, 404, 422].includes(error.status)) throw error;
    structured = false;
    try{raw = await requestModel(config, `${prompt}\n严格只返回 JSON 对象。`, { structured: false, payload, ...modelOptions })}catch(fallbackError){if(vision.ids.length)fallbackError.message=`当前模型或兼容接口可能不支持图片输入：${fallbackError.message}`;throw fallbackError}
  }
  const result = await completeAiVariants({ raw, payload: validationPayload, expectedCount, requestSupplement: async ({ missingCount, acceptedVariants, issues }) => {
    const supplementPayload = { ...payload, variantCount: missingCount };
    // 补生成与初次请求共用同一层结构（4 → 5 → 6），不把新任务追加到第 6 层之后。
    const supplementPrompt = buildSupplementPrompt(payload, bundle, { missingCount, acceptedVariants, issues });
    const supplementSchema = createLoreResponseSchema(supplementPayload);
    if (!structured) return requestModel(config, `${supplementPrompt}\n严格只返回 JSON 对象。`, { structured: false, payload: supplementPayload, ...modelOptions });
    try { return await requestModel(config, supplementPrompt, { structured: true, schema: supplementSchema, payload: supplementPayload, ...modelOptions }); }
    catch (error) {
      if (![400, 404, 422].includes(error.status)) throw error;
      return requestModel(config, `${supplementPrompt}\n严格只返回 JSON 对象。`, { structured: false, payload: supplementPayload, ...modelOptions });
    }
  } });
  return { ...result, agent, harnessVersion: HARNESS_VERSION, contextMeta: {...bundle.contextMeta,visionAssetIds:vision.ids} };
}

async function callFreeAgent(payload) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置 LLM_API_KEY');
  const profile = resolveSurfaceProfile('free', payload?.presetId);
  const agent = agentSnapshot(profile);
  const policyTools = toolsForPolicy(profile);
  const messages = [];
  for (const item of (Array.isArray(payload?.messages) ? payload.messages.slice(-20) : [])) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content || '').trim().slice(0, 12000);
    if (!content) continue;
    const message = { role, content };
    // 作者从素材库显式附加的图片：客户端只发资产编号，服务端在这里读成图片。
    const assets = role === 'user' && Array.isArray(item?.assets) ? item.assets.slice(0, AGENT_LIMITS.maxImages) : [];
    if (assets.length) {
      const attached = await resolveAgentImages(assets, AGENT_LIMITS.maxImages);
      if (attached.images.length) message.images = attached.images;
      if (attached.missing.length) message.content = `${content}\n（有 ${attached.missing.length} 张图片附件无法读取：${attached.missing.join('、')}）`;
    }
    messages.push(message);
  }
  if (!messages.length || messages.at(-1).role !== 'user') throw new Error('请先输入创作需求');
  const related = String(payload?.relatedInformation || '').trim().slice(0, 20000);
  const library = prepareLibrary(payload?.library);
  const artAssets = prepareArtAssets(payload?.artAssets);
  const available = library.length > 0 || artAssets.length > 0;
  // 工具策略与可用范围取交集：策略为 none 的 preset 即使给了资料也不获得工具。
  const useTools = available && policyTools.length > 0;
  const attachedCount = messages.reduce((sum, message) => sum + (message.images?.length || 0), 0);
  const inventory = [
    `作者提供了可检索资料 ${library.length} 条`,
    artAssets.length ? `可查看美术资产 ${artAssets.length} 个` : '',
    attachedCount ? `并在消息里直接附了 ${attachedCount} 张图片` : ''
  ].filter(Boolean).join('，');
  // 第 1–3 层只放产品与 preset 内容；作者笔记与资料正文属于第 6 层，
  // 只能附到用户侧最后一条消息（ADR-0029 §7），不得进入 system/entry_contract。
  const systemFor = withTools => composeAgentSystemPrompt({
    presetPrompt: profile.systemPrompt,
    entryContract: FREE_ENTRY_CONTRACT,
    extraContracts: [`本次可用范围：${inventory}。`, withTools ? FREE_AGENT_TOOL_GUIDE : '']
  });
  const relatedNotes = related ? `<author_notes>\n${related}\n</author_notes>` : '';
  const loopMessages = attachUntrustedContext(messages, [relatedNotes]);
  const runTool = async (name, args) => {
    const outcome = runToolCall(name, args, library, artAssets);
    if (Array.isArray(outcome.imageIds) && outcome.imageIds.length) {
      const resolved = await resolveAgentImages(outcome.imageIds, AGENT_LIMITS.maxImages);
      outcome.images = resolved.images;
      outcome.summary = `附上 ${resolved.images.length} 张原画`;
      if (resolved.missing.length) outcome.content = `${outcome.content}\n无法读取的美术资产：${resolved.missing.join('、')}`;
    }
    return outcome;
  };
  const callModelFor = withTools => createToolCaller({ config, system: systemFor(withTools) });
  const describe = (result, toolMode) => ({
    reply: result.reply.slice(0, 50000), model: config.model, toolMode,
    // images 汇报本次模型实际收到的图片总数：作者显式附件 + 工具附图
    vision: result.vision, images: attachedCount + result.images, trace: result.trace,
    rounds: result.rounds, toolCalls: result.toolCalls, stopped: result.stopped,
    // 每轮/每次响应回显该请求实际使用的 preset 快照，客户端不能伪造。
    agent
  });

  try {
    const result = await runAgentLoop({ messages: loopMessages, tools: useTools ? policyTools : [], maxRounds: useTools ? undefined : 1, callModel: callModelFor(useTools), runTool });
    if (!result.reply) throw new Error(useTools ? '模型只调用了工具但没有给出回答，请重试或更换模型' : '模型没有返回内容');
    return describe(result, useTools ? 'native' : 'none');
  } catch (error) {
    if (!useTools || ![400, 404, 422].includes(error.status)) throw error;
    // 兼容接口不支持工具调用：退回一轮不带工具的问答，把条目索引放进用户侧上下文。
    // 附图仍然保留，因为作者显式附加的图片不该因为接口不支持工具而消失。
    // 降级路径必须保留同一 preset 快照，不能换回固定提示。
    const index = library.slice(0, 120).map(entry => ({ id: entry.id, type: entry.type, name: entry.name, status: entry.status, truthScope: entry.truthScope, worldId: entry.worldId, summary: entry.summary }));
    const fallbackSystem = systemFor(false);
    // 资料库正文与作者笔记一样属于第 6 层：只进用户侧，不进 system。
    const fallbackMessages = attachUntrustedContext(messages, [relatedNotes, `<library_context>\n${JSON.stringify(index, null, 2)}\n</library_context>`]);
    const result = await runAgentLoop({ messages: fallbackMessages, tools: [], maxRounds: 1, callModel: createToolCaller({ config, system: fallbackSystem }), runTool: () => ({ ok: false, summary: '本次运行不提供工具', content: '{}' }) });
    if (!result.reply) throw new Error('模型没有返回内容');
    return { ...describe(result, 'unavailable'), fallbackReason: error.message };
  }
}

async function callNameGenerator(payload) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置 LLM_API_KEY');
  const count = [3, 5, 8, 10].includes(Number(payload?.count)) ? Number(payload.count) : 5;
  const category = String(payload?.category || '设定').trim().slice(0, 80), requirements = String(payload?.requirements || '').trim().slice(0, 4000), context = String(payload?.context || '').trim().slice(0, 8000);
  const prompt = `为原创世界观生成 ${count} 个“${category}”名称。名称之间要有明显差异，并符合作者要求与关联信息。每个名称附一条简短命名说明；不要引用商业 IP 专有名称。\n作者要求：${requirements || '无'}\n<related_information>\n${context || '无'}\n</related_information>`;
  let raw;
  try { raw = await requestModel(config, prompt, { structured: true, schema: NAME_RESPONSE_SCHEMA, name: 'worldforge_names' }); }
  catch (error) { if (![400, 404, 422].includes(error.status)) throw error; raw = await requestModel(config, `${prompt}\n严格返回 JSON：{"names":[{"name":"名称","note":"说明"}]}`, { structured: false }); }
  return { ...parseNameResponse(raw, count), model: config.model };
}

async function callMacroProposal(payload) {
  const regionId = String(payload?.regionId || '');
  const context = macroSimulation.localContext(regionId);
  const config = aiConfig();
  if (!config.key) return { ...macroSimulation.fallbackProposal(regionId), source: 'rule_fallback', fallbackReason: '尚未配置语言模型' };
  try {
    const prompt = buildMacroProposalPrompt(context);
    let raw;
    try { raw = await requestModel(config, prompt, { structured: true, schema: MACRO_PROPOSAL_SCHEMA, name: 'macro_local_proposal' }); }
    catch (error) {
      if (![400, 404, 422].includes(error.status)) throw error;
      raw = await requestModel(config, `${prompt}\n严格只返回 JSON 对象。`, { structured: false });
    }
    const proposal = macroSimulation.parseModelProposal(raw, regionId);
    return { ...macroSimulation.validateProposal(proposal, regionId), source: 'llm', model: config.model, context };
  } catch (error) {
    return { ...macroSimulation.fallbackProposal(regionId), source: 'rule_fallback', fallbackReason: String(error.message || '模型提案失败').slice(0, 300) };
  }
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, safe);
  if (!file.startsWith(dist)) return json(res, 403, { error: '禁止访问' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(content);
  } catch { const content = await readFile(join(dist, 'index.html')); res.writeHead(200, { ...securityHeaders, 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' }); res.end(content); }
}

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://localhost'), pathname = requestUrl.pathname;
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { status: 'ok', database: contentStore.health(), simulation: simulationDashboard.health(), macroSimulation: macroSimulation.health(), agentProfiles: registryHealthSummary(agentProfiles) });
    if (req.method === 'GET' && req.url === '/api/macro') return json(res, 200, macroSimulation.view());
    if (req.method === 'POST' && req.url === '/api/macro/step') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, macroSimulation.step(await readBody(req)));
    }
    if (req.method === 'POST' && req.url === '/api/macro/run') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, macroSimulation.run(await readBody(req)));
    }
    if (req.method === 'POST' && req.url === '/api/macro/reset') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, macroSimulation.reset(await readBody(req)));
    }
    if (req.method === 'POST' && req.url === '/api/macro/local-proposal') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, await callMacroProposal(await readBody(req)));
    }
    if (req.method === 'GET' && req.url === '/api/simulation') return json(res, 200, simulationDashboard.view());
    if (req.method === 'POST' && req.url === '/api/simulation/advance') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, simulationDashboard.advance(await readBody(req)));
    }
    if (req.method === 'POST' && req.url === '/api/simulation/run') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, simulationDashboard.run(await readBody(req)));
    }
    if (req.method === 'POST' && req.url === '/api/simulation/reset') {
      if (req.headers['x-worldforge-simulation'] !== '1') return json(res, 403, { error: '缺少模拟推进请求标记' });
      return json(res, 200, simulationDashboard.reset(await readBody(req)));
    }
    if (req.method === 'GET' && req.url === '/api/content') return json(res, 200, contentStore.read());
    if (req.method === 'PUT' && req.url === '/api/content') {
      if (req.headers['x-worldforge-content'] !== '1') return json(res, 403, { error: '缺少内容保存请求标记' });
      return json(res, 200, contentStore.replace(await readBody(req)));
    }
    if (req.method === 'GET' && req.url === '/api/art-assets') return json(res, 200, { assets: contentStore.listArtAssets() });
    if (req.method === 'POST' && req.url === '/api/reference-assets') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片上传请求标记' });
      return json(res, 201, { asset: await createReferenceAsset(await readBody(req, 12 * 1024 * 1024)) });
    }
    const artMatch = pathname.match(/^\/api\/art-assets\/(ART-[A-F0-9-]+)\/file$/i);
    if (req.method === 'GET' && artMatch) return serveArtAsset(artMatch[1], res, requestUrl.searchParams.get('download') === '1');
    const artUnbindMatch = pathname.match(/^\/api\/art-assets\/(ART-[A-F0-9-]+)\/unbind$/i);
    if (req.method === 'POST' && artUnbindMatch) {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少美术资产操作请求标记' });
      const asset = contentStore.setArtAssetTarget(artUnbindMatch[1], null);
      if (!asset) return json(res, 404, { error: '美术资产不存在' });
      return json(res, 200, { asset });
    }
    if (req.method === 'GET' && req.url === '/api/seedream/status') { const c = seedreamConfig(); return json(res, 200, { configured: Boolean(c.key), model: c.model, baseUrl: c.baseUrl }); }
    if (req.method === 'GET' && req.url === '/api/images/status') { const seedream = seedreamConfig(), comfyUi = comfyUiConfig(); return json(res, 200, { seedream: { configured: Boolean(seedream.key), model: seedream.model, baseUrl: seedream.baseUrl }, comfyUi: { configured: Boolean(await loadComfyWorkflow()), baseUrl: comfyUi.baseUrl } }); }
    if (req.method === 'POST' && req.url === '/api/images/generate') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片生成请求标记' });
      const payload = await readBody(req), requestId = String(payload?.clientRequestId || randomUUID()).slice(0, 80), startedAt = Date.now();
      console.log(`[images/generate] start request=${requestId} provider=${payload?.provider === 'comfyui' ? 'comfyui' : 'seedream'} target=${String(payload?.targetId || payload?.cardId || '').slice(0, 160)}`);
      try {
        const asset = await createArtAsset({ ...payload, clientRequestId: requestId });
        console.log(`[images/generate] success request=${requestId} asset=${asset.id} elapsedMs=${Date.now() - startedAt}`);
        return json(res, 200, { asset, requestId });
      } catch (error) {
        console.error(`[images/generate] failed request=${requestId} elapsedMs=${Date.now() - startedAt} error=${String(error.message || error).slice(0, 500)}`);
        return json(res, error.status || 500, { error: error.message || '图片生成失败', requestId });
      }
    }
    if (req.method === 'POST' && req.url === '/api/images/compose-prompt') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片生成请求标记' });
      return json(res, 200, composeImagePrompt(await readBody(req),await loadPromptSettings()));
    }
    if (req.method === 'POST' && req.url === '/api/images/optimize-prompt') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片生成请求标记' });
      return json(res, 200, await optimizeImagePrompt(await readBody(req)));
    }
    if (req.method === 'GET' && req.url === '/api/ai/status') { const c = aiConfig(); return json(res, 200, { configured: Boolean(c.key), model: c.model, style: c.style }); }
    // 只返回脱敏元数据与默认映射：不含系统提示正文、文件路径或 DSH 插件明细。
    if (req.method === 'GET' && req.url === '/api/ai/presets') return json(res, 200, publicRegistryView(agentProfiles));
    if (req.method === 'GET' && req.url === '/api/settings') { const c = aiConfig(), image = seedreamConfig(), comfyUi = comfyUiConfig(), workflow = await loadComfyWorkflow(), prompts = await loadPromptSettings(); return json(res, 200, { configured: Boolean(c.key), baseUrl: c.baseUrl, model: c.model, style: c.style, seedreamConfigured: Boolean(image.key), seedreamBaseUrl: image.baseUrl, seedreamModel: image.model, comfyUiBaseUrl: comfyUi.baseUrl, comfyUiConfigured: Boolean(workflow), comfyUiWorkflow: workflow ? JSON.stringify(workflow, null, 2) : '', promptSettings: prompts, promptDefaults: DEFAULT_TYPE_PROMPTS, imagePromptDefaults:DEFAULT_IMAGE_PROMPTS, visualStyleDefault:DEFAULT_VISUAL_STYLE_PROMPT }); }
    if (req.method === 'POST' && req.url === '/api/settings') {
      if (req.headers['x-worldforge-settings'] !== '1') return json(res, 403, { error: '缺少本机设置请求标记' });
      const settings = validateSettings(await readBody(req));
      const values = { LLM_BASE_URL: settings.baseUrl, LLM_MODEL: settings.model, LLM_API_STYLE: settings.style, SEEDREAM_BASE_URL: settings.seedream.baseUrl, SEEDREAM_MODEL: settings.seedream.model, COMFYUI_BASE_URL: settings.comfyUi.baseUrl };
      if (settings.apiKey !== undefined) values.LLM_API_KEY = settings.apiKey;
      if (settings.seedream.apiKey !== undefined) values.SEEDREAM_API_KEY = settings.seedream.apiKey;
      await saveLocalEnv(values);
      await saveComfyWorkflow(settings.comfyUi.workflow);
      await savePromptSettings(settings.prompts);
      const c = aiConfig(), image = seedreamConfig(), comfyUi = comfyUiConfig(), prompts = await loadPromptSettings(); return json(res, 200, { configured: Boolean(c.key), baseUrl: c.baseUrl, model: c.model, style: c.style, seedreamConfigured: Boolean(image.key), seedreamBaseUrl: image.baseUrl, seedreamModel: image.model, comfyUiConfigured: Boolean(await loadComfyWorkflow()), comfyUiBaseUrl: comfyUi.baseUrl, promptSettings: prompts, promptDefaults: DEFAULT_TYPE_PROMPTS, imagePromptDefaults:DEFAULT_IMAGE_PROMPTS, visualStyleDefault:DEFAULT_VISUAL_STYLE_PROMPT });
    }
    if (req.method === 'POST' && req.url === '/api/ai/free') return json(res, 200, await callFreeAgent(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/ai/tools/names') return json(res, 200, await callNameGenerator(await readBody(req)));
    if (req.method === 'POST' && req.url === '/api/ai') { const payload = await readBody(req); return json(res, 200, await callAi(payload)); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持的请求方法' });
    return serveStatic(req, res);
  } catch (error) { return json(res, error.status || 500, { error: error.message || '服务器错误' }); }
}).listen(port, '0.0.0.0', () => console.log(`Worldforge: http://127.0.0.1:${port}`));
