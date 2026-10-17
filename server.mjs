import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUntrustedContext, buildCardPrompt, buildContextBundle, buildPrompt, buildSupplementPrompt, CARD_ENTRY_CONTRACT, completeAiVariants, composeAgentSystemPrompt, createLoreResponseSchema, createModelBody, FREE_AGENT_TOOL_GUIDE, FREE_ENTRY_CONTRACT, HARNESS_VERSION, LORE_ENTRY_CONTRACT, NAME_RESPONSE_SCHEMA, parseNameResponse } from './ai-harness.mjs';
import { CARD_ACTIONS, CARD_FIELDS, completeCardVariants, createCardResponseSchema } from './card-agent.mjs';
import { AGENT_LIMITS, FREE_AGENT_TOOLS, prepareArtAssets, prepareLibrary, runToolCall } from './ai-tools.mjs';
import { createToolCaller, runAgentLoop } from './ai-agent.mjs';
import { comfyUiConfig, generateComfyUiImage, validateComfyUiSettings } from './comfyui.mjs';
import { createContentStore, validateContentSnapshot } from './storage.mjs';
import { composeImagePrompt } from './image-context.mjs';
import { generateSeedreamImage, seedreamConfig, validateImageRequest, validateSeedreamSettings } from './seedream.mjs';
import { normalizeReferenceAssetIds, parseReferenceUpload, toReferenceDataUrl } from './reference-assets.mjs';
import { DEFAULT_IMAGE_PROMPTS, DEFAULT_TYPE_PROMPTS, DEFAULT_VISUAL_STYLE_PROMPT, normalizePromptSettings, validatePromptSettings } from './prompt-settings.mjs';
import { asAgentProfileError, loadAgentProfiles, publicRegistryView, registryHealthSummary } from './agent-profile-registry.mjs';
import { LEGACY_PROMPTS_ENV, LEGACY_PROMPT_SOURCE, legacyDefaults, legacyPresetsView, legacyProfile, legacyPromptsEnabled, legacyRegistryHealth } from './agent-legacy.mjs';
import { AGENT_SETTINGS_ENV, AGENT_SETTINGS_FILENAME, loadAgentSettings, publicAgentSelections, saveAgentSettings, validateAgentSelectionPatch } from './agent-settings.mjs';
import { AUTH_DEFAULT_QUOTA, AUTH_REQUIRE_ENV, AUTH_USERS_ENV, clearSessionCookie, cookieSecureMode, isSecureRequest, openAuthStore, sessionCookie } from './auth.mjs';
import { buildExportBundle, extensionForMimeType, parseImportBundle, planArtAssetImport, planImport } from './data-transfer.mjs';
import { promptKeyOf, MAX_LORE_GROUPS } from './lore-groups.mjs';
import { buildImportPlan, buildImportPrompt, buildWorldEntry, IMPORT_EXTRACTION_SCHEMA, LORE_IMPORT_ENTRY_CONTRACT, LORE_IMPORT_LIMITS, mergeExtractions, nextWorldIdOf, normalizeExtraction, normalizeImportSource, splitImportSource, validateImportPlan } from './lore-import.mjs';
import { extractImportDocuments } from './lore-import-files.mjs';
import { createSimulationDashboardService } from './simulation/dashboard-service.mjs';
import { createMacroSimulationService } from './simulation/macro-simulation-service.mjs';
import { buildMacroProposalPrompt, MACRO_PROPOSAL_SCHEMA } from './simulation/llm/macro-proposal.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');
const envPath = process.env.WORLDFORGE_CONFIG_PATH || join(root, '.env.local');
const comfyWorkflowPath = process.env.WORLDFORGE_COMFY_WORKFLOW_PATH || join(dirname(envPath), 'comfyui-workflow.json');
const promptSettingsPath = process.env.WORLDFORGE_PROMPT_SETTINGS_PATH || join(dirname(envPath), 'prompt-settings.json');
// Agent 选择单独一份文件：不写 .env.local，也不与作者可编辑的分类提示词混在一起。
const agentSettingsPath = process.env[AGENT_SETTINGS_ENV] || join(dirname(envPath), AGENT_SETTINGS_FILENAME);
// 账号库与 .env.local 同目录（Docker 内为 /data/users.json）。只有存在 users.json 才启用登录；
// WORLDFORGE_REQUIRE_AUTH=1 时缺失或损坏直接拒绝启动，避免“忘了建账号就暴露公网”（ADR-0030）。
const usersPath = process.env[AUTH_USERS_ENV] || join(dirname(envPath), 'users.json');
const requireAuth = process.env[AUTH_REQUIRE_ENV] === '1';

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
// 作者资料库可以跑在 SQLite（默认，零依赖）或 PostgreSQL 上。选 pg 时按需动态导入驱动，
// 因此纯 SQLite 部署不需要安装任何第三方包。模拟存档仍固定使用独立的 SQLite 文件。
const DATABASE_DRIVER_ENV = 'WORLDFORGE_DB_DRIVER';
const DATABASE_URL_ENV = 'WORLDFORGE_DATABASE_URL';
const requestedDriver = String(process.env[DATABASE_DRIVER_ENV] || '').trim().toLowerCase();
const databaseUrl = String(process.env[DATABASE_URL_ENV] || '').trim();
const databaseDriver = requestedDriver || (databaseUrl ? 'postgres' : 'sqlite');
if (!['sqlite', 'postgres'].includes(databaseDriver)) {
  console.error(`[storage] ${DATABASE_DRIVER_ENV}=${databaseDriver} 不受支持；可选 sqlite 或 postgres。`);
  process.exit(1);
}
if (databaseDriver === 'postgres' && !databaseUrl) {
  console.error(`[storage] 选择 ${databaseDriver} 时必须设置 ${DATABASE_URL_ENV}（postgres://user:password@host:port/database）。`);
  process.exit(1);
}
const contentStore = databaseDriver === 'postgres'
  ? await import('./storage-postgres.mjs').then(module => module.createPostgresContentStore({ connectionString: databaseUrl }))
  : createContentStore(databasePath);
console.log(`[storage] 作者资料库驱动：${databaseDriver}`);
const simulationDatabasePath = process.env.WORLDFORGE_SIM_DB_PATH || join(dirname(databasePath), 'worldforge-simulation.sqlite');
const simulationDashboard = createSimulationDashboardService(simulationDatabasePath);
const macroSimulation = createMacroSimulationService(simulationDatabasePath);
await mkdir(assetsPath, { recursive: true });

// 产品版本来自 package.json（镜像内随 COPY 交付）。启动读一次，请求期不再读盘；
// 前端用它判断「页面打包的版本」与「正在运行的实例」是否一致（stale 缓存诊断）。
const PRODUCT_VERSION = await readProductVersion();

// 回滚开关（计划 §12.4）：默认关闭，只有精确的 `1` 才启用。启用后三个入口改用代码内
// 固定 persona；第 1 层安全边界、第 3 层入口契约、Schema、工具白名单与 canon 纪律不变。
const legacyPrompts = legacyPromptsEnabled();

// Agent Profile Registry：启动时一次性加载并冻结，请求期间不再读取磁盘，
// 因此不会读到半写入文件。任何无效、损坏或不兼容的 preset 都会拒绝启动并打印
// 稳定错误码，而不是跳过或静默换用其他 persona（ADR-0029 §9、计划 §12.1）。
// 唯一例外是显式打开回滚开关：此时才允许降级启动，并由 /api/health 明确报告 degraded。
let agentProfiles = null;
let agentRegistryFailure = null;
try {
  agentProfiles = await loadAgentProfiles();
  const summary = registryHealthSummary(agentProfiles);
  console.log(`[agent-profiles] loaded ${summary.count} preset(s): ${summary.ids.join(', ')}`);
  if (legacyPrompts) console.warn(`[agent-profiles] 回滚模式（${LEGACY_PROMPTS_ENV}=1）：三个入口使用代码内固定 persona，preset 提示词不参与请求。`);
} catch (error) {
  const failure = asAgentProfileError(error);
  console.error(`[agent-profiles] ${failure.code}: ${failure.message}`);
  for (const detail of failure.details) console.error(`[agent-profiles]   - ${detail}`);
  if (!legacyPrompts) {
    console.error('[agent-profiles] 拒绝启动：请修复或移除损坏的 preset 投影后重试。产品不会自动改用其他 persona。');
    // 必须显式退出：数据库与模拟服务在启动阶段已经打开，仅 throw 会让事件循环保持存活，
    // 容器会表现为"启动失败但不退出"，本机也会留下锁定的 SQLite 文件。
    process.exit(1);
  }
  agentRegistryFailure = failure;
  console.warn('[agent-profiles] 已按显式回滚开关降级启动：/api/health 报告 degraded，三个入口使用固定提示。');
}

// 按 surface 保存的服务端默认选择（Sprint 3）。旧安装没有该文件时使用 Registry 默认值；
// 文件损坏时同样回落默认值并记录原因，但绝不因为某个 preset 消失就自动改选其他 persona。
let agentSettings = await loadAgentSettings(agentSettingsPath, { defaults: agentDefaults() });
if (agentSettings.reason) console.warn(`[agent-settings] using defaults (${agentSettings.reason}) at ${agentSettingsPath}`);
else console.log(`[agent-settings] ${AGENT_SURFACES_FOR_LOG(agentSettings)}`);

// —— 账号与会话（ADR-0030）——
// 存在 users.json 才启用登录；匿名模式只保留给本机开发与既有测试，公网部署必须 REQUIRE_AUTH=1。
// 账号库缺失或损坏时：REQUIRE_AUTH=1 拒绝启动（fail-closed），否则明确警告后以匿名模式运行。
let auth = null;
try {
  auth = await openAuthStore({ usersPath, requireAuth, quotaDefaults: AUTH_DEFAULT_QUOTA });
  console.log(`[auth] 账号模式：${auth.userCount()} 个账号（${usersPath}）`);
} catch (error) {
  if (!['AUTH_USERS_MISSING', 'AUTH_USERS_INVALID'].includes(error.code)) throw error;
  // AuthError 的 message 已带 `CODE: ` 前缀，避免重复打印错误码。
  console.error(`[auth] ${error.message}`);
  if (requireAuth) {
    console.error('[auth] 拒绝启动：WORLDFORGE_REQUIRE_AUTH=1 要求先创建账号库。');
    console.error('[auth] 在 NAS 上运行：docker compose exec worldforge node scripts/auth-cli.mjs add <用户名> --admin');
    process.exit(1);
  }
  console.warn('[auth] 已按匿名本机模式启动：所有 API 不需要登录，只适合 127.0.0.1 或 tailnet 内部使用。');
}

// 公开端点：健康检查（供 Docker HEALTHCHECK 使用）、登录、会话查询与退出；其余 /api/* 一律要求会话。
const AUTH_PUBLIC_API = new Set(['GET /api/health', 'GET /api/auth/session', 'POST /api/auth/login', 'POST /api/auth/logout']);
function apiNeedsSession(method, pathname) {
  return Boolean(auth) && pathname.startsWith('/api/') && !AUTH_PUBLIC_API.has(`${method} ${pathname}`);
}
function apiNeedsAdmin(method, pathname) {
  if (!auth) return false;
  if (pathname === '/api/settings' && (method === 'GET' || method === 'POST')) return true;
  // 导入会整库覆盖作者资料，属于管理员操作；导出只是读取，普通成员也可用。
  if (pathname === '/api/import' && method === 'POST') return true;
  return pathname === '/api/users' || pathname.startsWith('/api/users/');
}
function sessionOf(req) { return auth ? auth.sessionFromRequest(req) : null; }
function sessionView(session) {
  const base = { mode: auth ? 'accounts' : 'anonymous', required: requireAuth };
  if (!auth || !session) return { ...base, user: null };
  return { ...base, user: { username: session.username, role: session.role, usage: auth.usageFor(session.username) } };
}
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 64);
  return String(req.socket?.remoteAddress || '').slice(0, 64);
}
function cookieSecure(req) {
  const mode = cookieSecureMode();
  return mode === null ? isSecureRequest(req) : mode;
}
async function chargeQuota(kind, session) {
  if (!auth || !session) return;
  await auth.consumeQuota({ username: session.username, kind });
}
// `/api/health` 是公开端点（Docker HEALTHCHECK 也用它）：去掉绝对路径，避免向匿名访客
// 暴露 NAS/容器内的数据目录结构。内部诊断仍可通过文件系统日志获得。
function publicHealth(health) {
  // `target`（PostgreSQL 的 host/database）同样属于部署拓扑，和绝对路径一样不对外暴露。
  const { databasePath, target, ...rest } = health || {};
  return rest;
}

function AGENT_SURFACES_FOR_LOG(settings) {
  return Object.entries(settings.selections).map(([surface, id]) => `${surface}=${id}`).join(' ');
}

/** 回滚模式下三处对外视图统一改用 legacy 默认映射，避免界面显示「已选中某个 preset」。 */
function agentDefaults() {
  return legacyPrompts ? legacyDefaults() : agentProfiles.defaults;
}

/** `/api/health`：正常路径与既有摘要完全一致；降级或回滚时追加来源与诊断。 */
function agentRegistryHealth() {
  if (!agentProfiles) return legacyRegistryHealth(agentRegistryFailure);
  const summary = registryHealthSummary(agentProfiles);
  return legacyPrompts ? { ...summary, promptSource: LEGACY_PROMPT_SOURCE } : summary;
}

/** `/api/ai/presets`：回滚时保持既有结构并带 `fallback`，不假装 Registry 目录为空。 */
function agentPresetsView() {
  return legacyPrompts ? legacyPresetsView() : publicRegistryView(agentProfiles);
}

/** 回滚时保存 preset 选择只会让界面与真实行为不一致，因此直接拒绝而不是静默忽略。 */
function agentSelectionPatch(payload) {
  if (!legacyPrompts) return validateAgentSelectionPatch(payload?.agentPresets, { registry: agentProfiles });
  if (payload?.agentPresets && Object.keys(payload.agentPresets).length) {
    const error = new Error(`AGENT_SETTINGS_INVALID: 回滚模式（${LEGACY_PROMPTS_ENV}=1）下不接受 Agent preset 选择；请移除该开关并重启后再修改`);
    error.status = 400;
    throw error;
  }
  return {};
}

/** `/api/settings` 的 Agent 片段：回滚模式下显示固定提示，而不是会误导人的 preset id。 */
function agentSettingsView() {
  const view = {
    agentPresets: publicAgentSelections(agentSettings),
    agentPresetDefaults: agentDefaults(),
    agentSettingsSource: agentSettings.reason || 'file'
  };
  return legacyPrompts ? { ...view, agentPresets: legacyDefaults(), agentPromptSource: LEGACY_PROMPT_SOURCE } : view;
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
// 产品版本只用于显示与诊断：读不到 package.json 时回落到 0.0.0，不阻止启动。
async function readProductVersion() {
  try {
    const parsed = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
    if (typeof parsed?.version === 'string' && parsed.version.trim()) return parsed.version.trim();
  } catch { /* 版本不是启动前提 */ }
  return '0.0.0';
}
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
  try{return await contentStore.createArtAsset(asset)}catch(error){await unlink(file).catch(()=>{});throw error}
}

async function resolveReferenceImages(value, maximum = 10) {
  const ids=normalizeReferenceAssetIds(value).slice(0,maximum),images=[];
  for(const id of ids){const asset=await contentStore.getArtAsset(id);if(!asset)throw new Error(`参考图不存在：${id}`);const file=join(assetsPath,asset.fileName);if(!file.startsWith(assetsPath))throw new Error('参考图路径无效');images.push(toReferenceDataUrl(asset,await readFile(file)))}
  return{ids,images};
}

// Agent 取图：单个编号失败不影响其余图片，失败项如实回报给模型。
async function resolveAgentImages(value, maximum = AGENT_LIMITS.maxImages) {
  const wanted = (Array.isArray(value) ? value : []).slice(0, maximum);
  const images = [], attached = [], missing = [];
  for (const raw of wanted) {
    const id = String(raw || '').trim();
    if (!/^ART-[A-Fa-f0-9-]+$/.test(id)) { missing.push(id || '(空编号)'); continue; }
    const asset = await contentStore.getArtAsset(id);
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
    const existing = (await contentStore.listArtAssets()).find(asset => asset.clientRequestId === clientRequestId);
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
  try { return await contentStore.createArtAsset(asset); }
  catch (error) { await unlink(file).catch(() => {}); throw error; }
}

async function serveArtAsset(id, res, download = false) {
  const asset = await contentStore.getArtAsset(id);
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
  // 回滚模式：persona 来源固定为代码内提示，Registry 此时可能根本不可用，
  // 因此不再解析请求里的 presetId，也不把它当成错误——三处响应仍回显 legacy 快照。
  if (legacyPrompts) return legacyProfile(surface);
  // 解析优先级：请求快照 > 服务端按 surface 保存的默认值 > Registry 默认值。
  // 请求自带值时以请求为准，但版本与哈希永远由服务端解析结果回显（S3-05）。
  const explicit = presetId !== undefined && presetId !== null && presetId !== '';
  const requested = explicit ? String(presetId) : (agentSettings.selections[surface] || agentProfiles.defaults[surface]);
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

/**
 * 第 1–3 层系统提示。回滚模式不传 `presetPrompt`，第 2 层因此退回 `ai-harness.mjs` 的
 * 代码内固定 persona；入口契约与产品边界始终保持原样（计划 §12.0.1 第 3 条）。
 */
function agentSystemPrompt(profile, options) {
  if (profile.legacy) return composeAgentSystemPrompt(options);
  return composeAgentSystemPrompt({ presetPrompt: profile.systemPrompt, ...options });
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
  const system = agentSystemPrompt(profile, { entryContract: LORE_ENTRY_CONTRACT });
  const bundle = buildContextBundle(payload);
  const promptSettings = await loadPromptSettings();
  // promptPayload 已注入服务端作者提示（第 4 层），初次与补生成必须共用它，
  // 否则补生成会退回「无额外分类提示/无额外统一风格要求」。
  // 自定义资料组没有独立提示词档位，统一落到「世界信息」档（promptKeyOf 负责收敛）。
  // 但作者以前按旧类型保存过的提示词仍然优先：magic / faction 等旧键会先被精确命中，
  // 这样升级分组方式不会让已有的分类提示词变成无效设置。
  const typePrompt = payload?.group?.prompt || promptSettings.typePrompts[payload?.draft?.type] || promptSettings.typePrompts[promptKeyOf(payload?.draft?.type)] || '';
  const promptPayload = { ...payload, typePrompt, personalizedPrompt: promptSettings.personalizedPrompt };
  const prompt = buildPrompt(promptPayload, bundle);
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
    // 非结构化降级：JSON 要求由 buildPrompt 放进第 5 层，不能在 prompt 尾部追加，
    // 否则 prompt 已以第 6 层结束时顺序会退回 4→5→6→5。
    try{raw = await requestModel(config, buildPrompt(promptPayload, bundle, { requireJson: true }), { structured: false, payload, ...modelOptions })}catch(fallbackError){if(vision.ids.length)fallbackError.message=`当前模型或兼容接口可能不支持图片输入：${fallbackError.message}`;throw fallbackError}
  }
  const result = await completeAiVariants({ raw, payload: validationPayload, expectedCount, requestSupplement: async ({ missingCount, acceptedVariants, issues }) => {
    const supplementPayload = { ...promptPayload, variantCount: missingCount };
    // 补生成与初次请求共用同一 promptPayload（含第 4 层作者提示）与同一层结构（4 → 5 → 6）：
    // 数量要求、补生成指令与 Schema 都对齐 missingCount，不出现「严格返回 2 份」与「只补 1 份」并存。
    const supplementFor = requireJson => buildSupplementPrompt(supplementPayload, bundle, { missingCount, acceptedVariants, issues, requireJson });
    const supplementSchema = createLoreResponseSchema(supplementPayload);
    if (!structured) return requestModel(config, supplementFor(true), { structured: false, payload: supplementPayload, ...modelOptions });
    try { return await requestModel(config, supplementFor(false), { structured: true, schema: supplementSchema, payload: supplementPayload, ...modelOptions }); }
    catch (error) {
      if (![400, 404, 422].includes(error.status)) throw error;
      return requestModel(config, supplementFor(true), { structured: false, payload: supplementPayload, ...modelOptions });
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
  const systemFor = withTools => agentSystemPrompt(profile, {
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

/**
 * 卡牌入口的受限上下文：只发送当前草案、本次允许引用的 ID 与必要规则摘要。
 * 不读取数据库、卡牌库或模拟状态；AI 拿不到作者未显式提供的条目。
 */
function buildCardContext(payload) {
  const draft = payload?.draft && typeof payload.draft === 'object' ? payload.draft : {};
  const text = (value, limit) => String(value ?? '').trim().slice(0, limit);
  const ids = (value, limit) => (Array.isArray(value) ? [...new Set(value.map(item => text(item, 100)).filter(Boolean))].slice(0, limit) : []);
  const sanitized = {
    // worldId 必须进上下文：否则卡牌 Agent 无法判断该用哪个世界的 canon / proposed 资料。
    worldId: text(draft.worldId, 30),
    group: text(draft.group, 40),
    name: text(draft.name, 100),
    type: ['minion', 'spell', 'equipment'].includes(draft.type) ? draft.type : 'minion',
    rarity: ['common', 'rare', 'epic', 'legendary'].includes(draft.rarity) ? draft.rarity : 'common',
    cost: Number(draft.cost) || 0,
    attack: Number(draft.attack) || 0,
    health: Number(draft.health) || 0,
    durability: Number(draft.durability) || 0,
    tribeId: text(draft.tribeId, 60),
    spellSchoolId: text(draft.spellSchoolId, 60),
    rulesText: text(draft.rulesText, 2000),
    keywordIds: ids(draft.keywordIds, 12),
    loreRefs: ids(draft.loreRefs, 12)
  };
  // 限定为当前卡牌引用的 lore；携带摘要、约束、状态与事实层次，供一致性审查使用。
  // 只接受当前卡牌真正引用的条目：以 sanitized.loreRefs 为白名单求交集，防止请求体注入额外 lore。
  const referencedLoreIds = new Set(sanitized.loreRefs);
  const loreEntries = (Array.isArray(payload?.loreRefs) ? payload.loreRefs : []).filter(entry => referencedLoreIds.has(text(entry?.id, 100))).slice(0, 20).map(entry => ({
    id: text(entry?.id, 100),
    name: text(entry?.name, 160),
    worldId: text(entry?.worldId, 30),
    type: text(entry?.type, 40),
    status: text(entry?.status, 20),
    truthScope: text(entry?.truthScope, 30),
    summary: text(entry?.summary, 1200),
    constraints: Array.isArray(entry?.constraints) ? entry.constraints.map(item => text(item, 300)).filter(Boolean).slice(0, 8) : []
  })).filter(entry => entry.id);
  const keywordWhitelist = new Set([...sanitized.keywordIds, ...ids(payload?.allowedKeywordIds, 50)]);
  const keywords = (Array.isArray(payload?.keywords) ? payload.keywords : []).filter(item => keywordWhitelist.has(text(item?.id, 100))).slice(0, 30).map(item => ({
    id: text(item?.id, 100), name: text(item?.name, 60), definition: text(item?.definition, 300), status: text(item?.status, 20) || 'proposed'
  })).filter(item => item.id);
  return {
    draft: sanitized,
    loreEntries,
    loreIds: loreEntries.map(entry => entry.id),
    keywordIds: ids(payload?.allowedKeywordIds, 50),
    mechanicIds: ids(payload?.allowedMechanicIds, 50),
    // 基础对战规则尚未裁定，这里只声明状态，不把 W97 之类的实验世界当成产品设定。
    rules: { combat: '基础对战规则尚未裁定（内置对战沙箱为 experimental / untested，只读，不是任何世界的正史）', keywords }
  };
}

async function callCardAgent(payload) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置 LLM_API_KEY');
  const profile = resolveSurfaceProfile('card', payload?.presetId);
  const agent = agentSnapshot(profile);
  const action = CARD_ACTIONS.includes(payload?.action) ? payload.action : 'brainstorm';
  const selectedFields = (Array.isArray(payload?.selectedFields) ? payload.selectedFields : []).filter(field => CARD_FIELDS.includes(field));
  const context = buildCardContext(payload);
  const promptSettings = await loadPromptSettings();
  const promptPayload = { ...payload, action, selectedFields, personalizedPrompt: promptSettings.personalizedPrompt };
  const validationPayload = { ...promptPayload, draft: context.draft, allowedLoreIds: context.loreIds, allowedKeywordIds: context.keywordIds };
  const expectedCount = Math.min(3, Math.max(1, Number(payload?.variantCount) || 1));
  const schema = createCardResponseSchema({ selectedFields, variantCount: expectedCount });
  const system = agentSystemPrompt(profile, { entryContract: CARD_ENTRY_CONTRACT });
  const modelOptions = { system };
  const prompt = buildCardPrompt(promptPayload, context);

  let structured = true;
  // 兼容接口常忽略 response_format/json_schema：记录降级原因，便于在响应与日志里看清
  //「模型没接受结构化约束」，而不是把它伪装成模型输出不合格。
  let fallbackReason = null;
  let raw;
  try { raw = await requestModel(config, prompt, { structured: true, schema, payload: promptPayload, ...modelOptions }); }
  catch (error) {
    if (![400, 404, 422].includes(error.status)) throw error;
    structured = false;
    fallbackReason = `结构化请求被拒绝（HTTP ${error.status}）：${error.message}`;
    console.warn(`[ai/card] ${fallbackReason}；改用非结构化 JSON 约束重试。`);
    raw = await requestModel(config, buildCardPrompt(promptPayload, context, { requireJson: true }), { structured: false, payload: promptPayload, ...modelOptions });
  }
  const result = await completeCardVariants({
    raw,
    payload: validationPayload,
    expectedCount,
    requestSupplement: async ({ missingCount, acceptedVariants, issues }) => {
      const supplementPayload = { ...promptPayload, variantCount: missingCount };
      const supplementSchema = createCardResponseSchema({ selectedFields, variantCount: missingCount });
      const supplementPrompt = `${buildCardPrompt(supplementPayload, context, { requireJson: true })}\n\n<accepted_variants>\n${JSON.stringify(acceptedVariants, null, 2)}\n</accepted_variants>\n<validation_issues>\n${issues.slice(0, 8).map(item => `- ${item.index === null ? '整体' : `第 ${item.index + 1} 条`}：${item.message}`).join('\n') || '- 返回条数不足'}\n</validation_issues>`;
      if (!structured) return requestModel(config, supplementPrompt, { structured: false, payload: supplementPayload, ...modelOptions });
      try { return await requestModel(config, supplementPrompt, { structured: true, schema: supplementSchema, payload: supplementPayload, ...modelOptions }); }
      catch (error) {
        if (![400, 404, 422].includes(error.status)) throw error;
        return requestModel(config, supplementPrompt, { structured: false, payload: supplementPayload, ...modelOptions });
      }
    }
  });
  return { ...result, action, model: config.model, agent, structured, ...(fallbackReason ? { fallbackReason } : {}), contextMeta: { loreIds: context.loreIds, keywordIds: context.keywordIds, selectedFields } };
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

// ── 设定导入（ADR-0033）────────────────────────────────────────────────────
// 作者在主界面粘贴一篇长篇设定 → 服务端分段调用「已配置的设定 Agent」→ 每段返回
// 结构化条目 → 确定性地合并、分配编号、改写成项目资料格式 → 预览 → 作者确认后建世界。
// 解析不写库；写库只在 commit，且永远以 proposed 追加，不改动任何既有条目。

/** 有界并发：段数不多，但串行会让长文导入等太久，全并发又容易触发接口限流。 */
async function mapLimited(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 解析一次导入请求。逐段解析、逐段计费（每段一次模型调用 = 1 次 AI 配额），
 * 单段失败只记警告；只有全部段落都失败或配额不足时才整体失败。
 */
async function callLoreImport(payload, session) {
  const config = aiConfig();
  if (!config.key) throw new Error('尚未配置 LLM_API_KEY');
  // preset 在调用模型之前解析：未知或不兼容的 preset 不产生任何外部调用与费用。
  // 与设定助手共用「设定」入口的 preset：导入不另开一套 persona 选择。
  const profile = resolveSurfaceProfile('lore', payload?.presetId);
  const agent = agentSnapshot(profile);
  const source = normalizeImportSource(payload?.text);
  const split = splitImportSource(source.text);
  const chunks = split.chunks;
  console.log(`[lore-import] start chunks=${chunks.length} characters=${source.characters} truncated=${source.truncated} preset=${profile.id}`);
  const instructions = String(payload?.instruction || '').trim().slice(0, 300);
  const promptSettings = await loadPromptSettings();
  const system = agentSystemPrompt(profile, { entryContract: LORE_IMPORT_ENTRY_CONTRACT });
  const promptFor = (chunk, extra = {}) => buildImportPrompt({
    index: chunk.index,
    total: chunks.length,
    text: chunk.text,
    instruction: instructions,
    personalizedPrompt: promptSettings.personalizedPrompt,
    ...extra
  });
  const runChunk = async chunk => {
    await chargeQuota('ai', session);
    let structured = true;
    let fallbackReason = null;
    let raw;
    try {
      raw = await requestModel(config, promptFor(chunk), { structured: true, schema: IMPORT_EXTRACTION_SCHEMA, name: 'worldforge_lore_import', system });
    } catch (error) {
      // 配额不足是整体性错误：继续跑后面的段只会继续撞 429。
      if (error.code === 'AUTH_QUOTA_EXCEEDED' || error.status === 429) throw error;
      // 兼容接口常忽略 response_format/json_schema：改用非结构化 JSON 约束重试同一段。
      if (![400, 404, 422].includes(error.status)) return { chunk, error };
      structured = false;
      fallbackReason = `结构化请求被拒绝（HTTP ${error.status}）：${error.message}`;
      console.warn(`[lore-import] 第 ${chunk.index + 1}/${chunks.length} 段${fallbackReason}；改用非结构化 JSON 约束重试。`);
      try {
        raw = await requestModel(config, promptFor(chunk, { requireJson: true }), { structured: false, system });
      } catch (fallbackError) {
        if (fallbackError.code === 'AUTH_QUOTA_EXCEEDED' || fallbackError.status === 429) throw fallbackError;
        return { chunk, error: fallbackError };
      }
    }
    const normalized = normalizeExtraction(raw, { chunkIndex: chunk.index });
    return { chunk, ...normalized, structured, fallbackReason };
  };
  const outcomes = await mapLimited(chunks, LORE_IMPORT_LIMITS.concurrency, runChunk);
  const extractions = [], warnings = [], issues = [];
  let fallbackReason = null;
  for (const outcome of outcomes) {
    if (outcome.error) {
      issues.push({ code: 'CHUNK_FAILED', message: `第 ${outcome.chunk.index + 1}/${chunks.length} 段解析失败：${String(outcome.error.message || outcome.error).slice(0, 300)}` });
      continue;
    }
    extractions.push({ world: outcome.world, entries: outcome.entries });
    for (const issue of outcome.issues || []) issues.push({ code: issue.code, message: `第 ${issue.chunk + 1} 段：${issue.message}` });
    if (!fallbackReason && outcome.fallbackReason) fallbackReason = outcome.fallbackReason;
  }
  if (!extractions.length) {
    const reason = issues[0]?.message || '模型没有返回可用的抽取结果';
    throw new Error(`设定解析失败：${reason}`);
  }
  const merged = mergeExtractions(extractions);
  const current = await contentStore.read();
  const worldId = nextWorldIdOf(current.loreEntries);
  if (source.truncated) warnings.push({ code: 'SOURCE_TRUNCATED', message: `原文超过 ${LORE_IMPORT_LIMITS.characters} 字，只解析了前面部分（省略 ${source.droppedCharacters} 字）` });
  if (split.truncated) warnings.push({ code: 'SOURCE_TRUNCATED', message: `分段上限为 ${LORE_IMPORT_LIMITS.maxChunks} 段，最后 ${split.droppedCharacters} 字未解析` });
  if (!merged.entries.length) warnings.push({ code: 'EMPTY_EXTRACTION', message: '模型没有整理出任何条目；可以缩短原文或补充更明确的条目名称后重试' });
  const plan = buildImportPlan({
    worldId,
    world: merged.world,
    entries: merged.entries,
    warnings: [...warnings, ...merged.warnings, ...issues],
    extractions,
    source: { characters: source.characters, truncated: source.truncated, droppedCharacters: source.droppedCharacters + split.droppedCharacters },
    existingEntries: current.loreEntries
  });
  return {
    ...plan,
    agent,
    model: config.model,
    harnessVersion: HARNESS_VERSION,
    ...(fallbackReason ? { fallbackReason } : {})
  };
}

/**
 * 把作者确认过的导入计划写入内容库：追加一个世界条目及其资料，绝不改动既有条目。
 * `expectedRevision` 与 `PUT /api/content` 同一套乐观锁；世界编号冲突返回 409。
 */
async function commitLoreImport(body, { actor = '' } = {}) {
  const current = await contentStore.read();
  const plan = validateImportPlan(body?.plan ?? body, { existingEntries: current.loreEntries });
  const now = new Date().toISOString();
  const worldEntry = buildWorldEntry({ worldId: plan.worldId, world: plan.world, now: () => now });
  const groups = [...current.loreGroups];
  const warnings = [...plan.warnings];
  for (const group of plan.groups) {
    const exists = groups.some(item => item.id === group.id && (item.worldId || '') === (group.worldId || ''));
    if (exists) continue;
    if (groups.length >= MAX_LORE_GROUPS) {
      warnings.push({ code: 'GROUP_LIMIT_REACHED', message: `自定义资料组已达上限 ${MAX_LORE_GROUPS}，「${group.label}」未单独落库（读取时会按资料自动派生）` });
      continue;
    }
    groups.push(group);
  }
  const saved = await contentStore.replace({
    loreEntries: [...current.loreEntries, worldEntry, ...plan.entries],
    cardDrafts: current.cardDrafts,
    keywords: current.keywords,
    loreGroups: groups,
    notes: current.notes,
    expectedRevision: body?.expectedRevision
  }, { actor });
  console.log(`[lore-import] commit world=${plan.worldId} entries=${plan.entries.length} revision=${saved.revision}`);
  return { worldId: plan.worldId, world: worldEntry, entries: plan.entries, warnings, revision: saved.revision, lastSavedBy: saved.lastSavedBy };
}

// ── 数据导入 / 导出 ─────────────────────────────────────────────────────────
// 导出与导入都以「服务端内容库」为真值，而不是浏览器缓存；这样换机、换数据库
// （SQLite ↔ PostgreSQL）与多用户协作都能得到同一份完整快照。

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

/** 读取美术资产文件并转成 base64；文件缺失时只导出元数据，不阻止整包导出。 */
async function collectExportImages(artAssets) {
  const images = [];
  for (const asset of Array.isArray(artAssets) ? artAssets : []) {
    const fileName = String(asset?.fileName || '');
    if (!/^[A-Za-z0-9._-]+$/.test(fileName)) continue;
    try {
      const bytes = await readFile(join(assetsPath, fileName));
      images.push({ id: asset.id, fileName, mimeType: asset.mimeType, dataBase64: bytes.toString('base64') });
    } catch { /* 文件缺失：导出的元数据仍然有效 */ }
  }
  return images;
}

async function runImport(body, { actor = '' } = {}) {
  const parsed = parseImportBundle(body?.payload ?? body);
  const mode = body?.mode === 'replace' ? 'replace' : 'merge';
  const dryRun = body?.dryRun === true;
  const current = await contentStore.read();
  // dryRun 与真实导入共用同一套结构校验，预检结果才可信。
  const validated = validateContentSnapshot(parsed.content);
  const plan = planImport(current, validated, mode);
  const artPlan = planArtAssetImport(await contentStore.listArtAssets(), parsed.artAssets);
  const summary = { ...plan.summary, artAssets: { ...artPlan.summary, registered: 0 }, images: { written: 0, existing: 0, failed: 0 } };
  if (dryRun) return { dryRun: true, summary, meta: parsed.meta, revision: current.revision };
  const saved = await contentStore.replace({ ...plan.content, expectedRevision: body?.expectedRevision }, { actor });
  // 内容提交后再落图片：内容失败时不会留下半套资产。
  const pending = new Map(artPlan.added.map(asset => [asset.id, asset]));
  for (const image of parsed.images) {
    const asset = pending.get(image.id);
    const fileName = String((asset && asset.fileName) || image.fileName || '');
    if (!asset || !/^[A-Za-z0-9._-]+$/.test(fileName)) { summary.images.failed += 1; continue; }
    const file = join(assetsPath, fileName);
    if (await fileExists(file)) { summary.images.existing += 1; continue; }
    const stagedFile = `${file}.import`;
    try {
      await writeFile(stagedFile, Buffer.from(image.dataBase64, 'base64'), { mode: 0o600 });
      await rename(stagedFile, file);
      summary.images.written += 1;
    } catch {
      await unlink(stagedFile).catch(() => {});
      summary.images.failed += 1;
    }
  }
  for (const asset of artPlan.added) {
    try { await contentStore.createArtAsset(asset); summary.artAssets.registered += 1; } catch { /* 元数据不完整时跳过；文件仍保留在磁盘上 */ }
  }
  return { dryRun: false, summary, meta: parsed.meta, revision: saved.revision, lastSavedBy: saved.lastSavedBy };
}

async function serveStatic(req, res, session) {  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // 未登录时把无扩展名的导航（`/`、`/worldforge/`）直接换成登录页：
  // 应用外壳与 API 都不发给匿名访客。带扩展名的静态资源本身不含数据，允许匿名取用。
  if (auth && !session && (!extname(pathname) || /\/index\.html$/.test(pathname))) {
    const login = await readFile(join(dist, 'login.html'));
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' });
    return res.end(login);
  }
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
    // 鉴权门禁在最前：未登录的 /api/* 直接 401，非管理员的设置与账号接口 403。
    // 匿名模式（未找到 users.json 且未要求鉴权）保持既有本机行为不变。
    const session = sessionOf(req);
    if (apiNeedsSession(req.method, pathname) && !session) return json(res, 401, { error: '需要登录后再访问', code: 'AUTH_REQUIRED' });
    if (apiNeedsAdmin(req.method, pathname) && session?.role !== 'admin') return json(res, 403, { error: '仅管理员可访问', code: 'AUTH_FORBIDDEN' });
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { status: 'ok', version: PRODUCT_VERSION, harnessVersion: HARNESS_VERSION, auth: auth ? auth.health() : { mode: 'anonymous', users: 0, requireAuth }, database: publicHealth(await contentStore.health()), simulation: publicHealth(simulationDashboard.health()), macroSimulation: publicHealth(macroSimulation.health()), agentProfiles: agentRegistryHealth() });
    if (req.method === 'GET' && req.url === '/api/auth/session') return json(res, 200, sessionView(session));
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少登录请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      const payload = await readBody(req);
      const result = await auth.login({ username: payload?.username, password: payload?.password, ip: clientIp(req), secure: cookieSecure(req) });
      res.setHeader('Set-Cookie', result.cookie);
      return json(res, 200, { user: result.user, expiresAt: result.expiresAt });
    }
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      if (auth && session) await auth.logout({ username: session.username });
      res.setHeader('Set-Cookie', clearSessionCookie({ secure: cookieSecure(req) }));
      return json(res, 200, { ok: true });
    }
    // 自助改口令：改完立即换发新会话，旧会话（含其他设备）因 sessionVersion 变更而失效。
    if (req.method === 'POST' && req.url === '/api/auth/password') {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少账号操作请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth || !session) return json(res, 401, { error: '需要登录后再修改口令', code: 'AUTH_REQUIRED' });
      const payload = await readBody(req);
      const changed = await auth.changePassword({ username: session.username, currentPassword: payload?.currentPassword, newPassword: payload?.newPassword });
      const renewed = await auth.sessionFor(session.username);
      res.setHeader('Set-Cookie', sessionCookie(renewed.token, { secure: cookieSecure(req) }));
      return json(res, 200, sessionView({ username: changed.user.username, role: changed.user.role }));
    }
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
      await chargeQuota('ai', session);
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
    if (req.method === 'GET' && req.url === '/api/content') return json(res, 200, await contentStore.read());
    if (req.method === 'PUT' && req.url === '/api/content') {
      if (req.headers['x-worldforge-content'] !== '1') return json(res, 403, { error: '缺少内容保存请求标记' });
      const saved = await contentStore.replace(await readBody(req), { actor: session?.username || 'anonymous' });
      if (auth) await auth.audit({ actor: session?.username || 'anonymous', action: 'content.save', detail: { revision: saved.revision, lore: saved.loreEntries.length, cards: saved.cardDrafts.length, keywords: saved.keywords.length, notes: Object.keys(saved.notes).length } });
      return json(res, 200, saved);
    }
    // 导出 / 导入：导出是普通成员可用的读取；导入会整库覆盖，路由前已由 apiNeedsAdmin 限制为管理员。
    if (req.method === 'GET' && pathname === '/api/export') {
      const includeImages = requestUrl.searchParams.get('images') === '1';
      const content = await contentStore.read(), artAssets = await contentStore.listArtAssets();
      const bundle = buildExportBundle({ content, artAssets, images: includeImages ? await collectExportImages(artAssets) : [], productVersion: PRODUCT_VERSION });
      const fileName = `worldforge-export-${String(bundle.exportedAt).slice(0, 10)}.json`;
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(bundle));
    }
    if (req.method === 'POST' && pathname === '/api/import') {
      if (req.headers['x-worldforge-import'] !== '1') return json(res, 403, { error: '缺少数据导入请求标记' });
      const body = await readBody(req, 160 * 1024 * 1024);
      let result;
      try {
        result = await runImport(body, { actor: session?.username || 'anonymous' });
      } catch (error) {
        // 导入文件不合格属于可预期的用户输入问题，返回 400 而不是 500；
        // 版本冲突（ContentConflictError）自带 409，保持原样。
        if (!error.status) error.status = 400;
        throw error;
      }
      if (!result.dryRun && auth) await auth.audit({ actor: session?.username || 'anonymous', action: 'content.import', detail: { mode: result.summary.mode, lore: result.summary.loreEntries.total, revision: result.revision } });
      return json(res, 200, result);
    }
    if (req.method === 'GET' && req.url === '/api/art-assets') return json(res, 200, { assets: await contentStore.listArtAssets() });
    if (req.method === 'POST' && req.url === '/api/reference-assets') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片上传请求标记' });
      return json(res, 201, { asset: await createReferenceAsset(await readBody(req, 12 * 1024 * 1024)) });
    }
    const artMatch = pathname.match(/^\/api\/art-assets\/(ART-[A-F0-9-]+)\/file$/i);
    if (req.method === 'GET' && artMatch) return serveArtAsset(artMatch[1], res, requestUrl.searchParams.get('download') === '1');
    const artUnbindMatch = pathname.match(/^\/api\/art-assets\/(ART-[A-F0-9-]+)\/unbind$/i);
    if (req.method === 'POST' && artUnbindMatch) {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少美术资产操作请求标记' });
      const asset = await contentStore.setArtAssetTarget(artUnbindMatch[1], null);
      if (!asset) return json(res, 404, { error: '美术资产不存在' });
      return json(res, 200, { asset });
    }
    if (req.method === 'GET' && req.url === '/api/seedream/status') { const c = seedreamConfig(); return json(res, 200, { configured: Boolean(c.key), model: c.model, baseUrl: c.baseUrl }); }
    if (req.method === 'GET' && req.url === '/api/images/status') { const seedream = seedreamConfig(), comfyUi = comfyUiConfig(); return json(res, 200, { seedream: { configured: Boolean(seedream.key), model: seedream.model, baseUrl: seedream.baseUrl }, comfyUi: { configured: Boolean(await loadComfyWorkflow()), baseUrl: comfyUi.baseUrl } }); }
    if (req.method === 'POST' && req.url === '/api/images/generate') {
      if (req.headers['x-worldforge-image'] !== '1') return json(res, 403, { error: '缺少图片生成请求标记' });
      await chargeQuota('image', session);
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
      await chargeQuota('ai', session);
      return json(res, 200, await optimizeImagePrompt(await readBody(req)));
    }
    if (req.method === 'GET' && req.url === '/api/ai/status') { const c = aiConfig(); return json(res, 200, { configured: Boolean(c.key), model: c.model, style: c.style }); }
    // 只返回脱敏元数据与默认映射：不含系统提示正文、文件路径或 DSH 插件明细。
    if (req.method === 'GET' && req.url === '/api/ai/presets') return json(res, 200, agentPresetsView());
    if (req.method === 'GET' && req.url === '/api/settings') { const c = aiConfig(), image = seedreamConfig(), comfyUi = comfyUiConfig(), workflow = await loadComfyWorkflow(), prompts = await loadPromptSettings(); return json(res, 200, { configured: Boolean(c.key), baseUrl: c.baseUrl, model: c.model, style: c.style, seedreamConfigured: Boolean(image.key), seedreamBaseUrl: image.baseUrl, seedreamModel: image.model, comfyUiBaseUrl: comfyUi.baseUrl, comfyUiConfigured: Boolean(workflow), comfyUiWorkflow: workflow ? JSON.stringify(workflow, null, 2) : '', promptSettings: prompts, promptDefaults: DEFAULT_TYPE_PROMPTS, imagePromptDefaults:DEFAULT_IMAGE_PROMPTS, visualStyleDefault:DEFAULT_VISUAL_STYLE_PROMPT, ...agentSettingsView() }); }
    if (req.method === 'POST' && req.url === '/api/settings') {
      if (req.headers['x-worldforge-settings'] !== '1') return json(res, 403, { error: '缺少本机设置请求标记' });
      const payload = await readBody(req);
      const settings = validateSettings(payload);
      // Agent 选择需要 Registry 校验，因此在通用设置之外单独处理；只提交部分入口时其余保持不变。
      const selectionPatch = agentSelectionPatch(payload);
      const values = { LLM_BASE_URL: settings.baseUrl, LLM_MODEL: settings.model, LLM_API_STYLE: settings.style, SEEDREAM_BASE_URL: settings.seedream.baseUrl, SEEDREAM_MODEL: settings.seedream.model, COMFYUI_BASE_URL: settings.comfyUi.baseUrl };
      if (settings.apiKey !== undefined) values.LLM_API_KEY = settings.apiKey;
      if (settings.seedream.apiKey !== undefined) values.SEEDREAM_API_KEY = settings.seedream.apiKey;
      await saveLocalEnv(values);
      await saveComfyWorkflow(settings.comfyUi.workflow);
      await savePromptSettings(settings.prompts);
      if (auth) await auth.audit({ actor: session.username, action: 'settings.update', detail: { fields: Object.keys(values) } });
      if (Object.keys(selectionPatch).length) {
        agentSettings = await saveAgentSettings(agentSettingsPath, { selections: { ...agentSettings.selections, ...selectionPatch } });
        console.log(`[agent-settings] updated ${Object.entries(selectionPatch).map(([surface, id]) => `${surface}=${id}`).join(' ')}`);
      }
      const c = aiConfig(), image = seedreamConfig(), comfyUi = comfyUiConfig(), prompts = await loadPromptSettings(); return json(res, 200, { configured: Boolean(c.key), baseUrl: c.baseUrl, model: c.model, style: c.style, seedreamConfigured: Boolean(image.key), seedreamBaseUrl: image.baseUrl, seedreamModel: image.model, comfyUiConfigured: Boolean(await loadComfyWorkflow()), comfyUiBaseUrl: comfyUi.baseUrl, promptSettings: prompts, promptDefaults: DEFAULT_TYPE_PROMPTS, imagePromptDefaults:DEFAULT_IMAGE_PROMPTS, visualStyleDefault:DEFAULT_VISUAL_STYLE_PROMPT, ...agentSettingsView() });
    }
    // —— 账号管理（仅管理员；apiNeedsAdmin 已在请求入口拦住非管理员）——
    // 口令只在校验/哈希后使用：创建与重置时未提供则生成一次性口令并在本次响应里返回一次。
    if (req.method === 'GET' && req.url === '/api/users') {
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      return json(res, 200, { users: auth.listUsers(), quotaDefaults: AUTH_DEFAULT_QUOTA });
    }
    if (req.method === 'POST' && req.url === '/api/users') {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少账号管理请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      const payload = await readBody(req);
      const result = await auth.createUser({ username: payload?.username, password: payload?.password ? String(payload.password) : undefined, role: payload?.role, quota: payload?.quota, actor: session.username });
      console.log(`[auth] ${session.username} 创建账号 ${result.user.username}（${result.user.role}）`);
      return json(res, 201, result);
    }
    const userPasswordMatch = pathname.match(/^\/api\/users\/([a-z0-9._-]{1,32})\/password$/);
    if (req.method === 'POST' && userPasswordMatch) {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少账号管理请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      const payload = await readBody(req);
      return json(res, 200, await auth.resetPassword({ username: userPasswordMatch[1], password: payload?.password ? String(payload.password) : undefined, actor: session.username }));
    }
    const userMatch = pathname.match(/^\/api\/users\/([a-z0-9._-]{1,32})$/);
    if (req.method === 'PATCH' && userMatch) {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少账号管理请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      const payload = await readBody(req);
      return json(res, 200, await auth.updateUser({ username: userMatch[1], patch: { role: payload?.role, disabled: payload?.disabled, quota: payload?.quota }, actor: session.username }));
    }
    if (req.method === 'DELETE' && userMatch) {
      if (req.headers['x-worldforge-auth'] !== '1') return json(res, 403, { error: '缺少账号管理请求标记', code: 'AUTH_HEADER_REQUIRED' });
      if (!auth) return json(res, 400, { error: '本实例未启用账号（未找到 users.json）', code: 'AUTH_DISABLED' });
      return json(res, 200, await auth.deleteUser({ username: userMatch[1], actor: session.username }));
    }
    if (req.method === 'POST' && req.url === '/api/ai/free') { await chargeQuota('ai', session); return json(res, 200, await callFreeAgent(await readBody(req))); }
    // 设定导入（ADR-0033）：解析不写库、按段计费；commit 只追加新世界，不覆盖既有资料。
    // 文件读取是纯本地变换（不调用模型、不写库），不计配额；体积上限在这一分支单独收口。
    if (req.method === 'POST' && req.url === '/api/lore-import/extract') {
      if (req.headers['x-worldforge-lore-import'] !== '1') return json(res, 403, { error: '缺少设定导入请求标记' });
      let body;
      try { body = await readBody(req, 48 * 1024 * 1024); }
      catch (error) { error.status = 400; throw error; }
      const result = extractImportDocuments(body?.files);
      console.log(`[lore-import] extract files=${result.files.length} characters=${result.characters} warnings=${result.warnings.length}`);
      return json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/lore-import/parse') { const payload = await readBody(req); return json(res, 200, await callLoreImport(payload, session)); }
    if (req.method === 'POST' && req.url === '/api/lore-import/commit') {
      if (req.headers['x-worldforge-lore-import'] !== '1') return json(res, 403, { error: '缺少设定导入请求标记' });
      const result = await commitLoreImport(await readBody(req), { actor: session?.username || 'anonymous' });
      if (auth) await auth.audit({ actor: session?.username || 'anonymous', action: 'content.import_lore', detail: { worldId: result.worldId, entries: result.entries.length, revision: result.revision } });
      return json(res, 200, result);
    }
    // 卡牌文字 Agent：只返回字段补丁（评审由作者完成），不保存、不生成图片、不改 canon。
    if (req.method === 'POST' && req.url === '/api/ai/card') { await chargeQuota('ai', session); return json(res, 200, await callCardAgent(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/ai/tools/names') { await chargeQuota('ai', session); return json(res, 200, await callNameGenerator(await readBody(req))); }
    if (req.method === 'POST' && req.url === '/api/ai') { const payload = await readBody(req); await chargeQuota('ai', session); return json(res, 200, await callAi(payload)); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持的请求方法' });
    // 必须 await：静态分支里的 readFile 失败要被本 catch 接住，否则会成为未处理的 rejection。
    return await serveStatic(req, res, session);
  } catch (error) {
    // AuthError 等业务错误带稳定 code/status/details；响应只给可读文本与 code，不回显堆栈。
    // 消息保留 `CODE: ` 前缀：既有 Agent 错误契约与前端诊断都依赖它，登录页自行裁掉前缀显示。
    const status = Number(error.status) || 500;
    const body = { error: String(error.message || '服务器错误') };
    if (typeof error.code === 'string') body.code = error.code;
    if (error.details && typeof error.details === 'object') Object.assign(body, error.details);
    return json(res, status, body);
  }
}).listen(port, '0.0.0.0', () => console.log(`Worldforge: http://127.0.0.1:${port}`));
