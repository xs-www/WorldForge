// Agent 选择设置（Sprint 3）：按 surface 保存服务端默认 preset。
//
// 与 prompt-settings.json、.env.local、SQLite 完全分离：本文件只存三个入口的
// preset id，不承载密钥、提示词或创作内容。读取失败时回落到 Registry 默认值，
// 但**不会**因为某个已保存 preset 消失就自动改选另一个 persona——那种情况由
// 解析层报 AGENT_PROFILE_UNKNOWN，让界面给出可理解的错误。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AGENT_SURFACES, AGENT_SURFACE_COMPATIBILITY } from './agent-profile-contract.mjs';

export const AGENT_SETTINGS_SCHEMA_VERSION = 1;
export const AGENT_SETTINGS_ENV = 'WORLDFORGE_AGENT_SETTINGS_PATH';
export const AGENT_SETTINGS_FILENAME = 'agent-settings.json';

export class AgentSettingsError extends Error {
  constructor(message) {
    super(`AGENT_SETTINGS_INVALID: ${message}`);
    this.name = 'AgentSettingsError';
    this.code = 'AGENT_SETTINGS_INVALID';
    this.status = 400;
  }
}

/** 旧安装与损坏文件都回落到这三个默认映射（计划 §12.2）。 */
export function defaultAgentSelections(registry) {
  return Object.fromEntries(AGENT_SURFACES.map(surface => [surface, registry?.defaults?.[surface] ?? null]));
}

function text(value, limit = 64) {
  const source = String(value ?? '').trim();
  return source.length > limit ? '' : source;
}

/**
 * 规范化磁盘上的设置。未知 surface、未知字段与空值一律丢弃，不回写、不猜测。
 * @returns {{ schemaVersion: number, selections: Record<string, string|null> }}
 */
export function normalizeAgentSettings(value, { defaults = {} } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const source = input.selections && typeof input.selections === 'object' && !Array.isArray(input.selections) ? input.selections : {};
  const selections = {};
  for (const surface of AGENT_SURFACES) {
    // 空值、超长值与缺失项都回落到默认映射；已是合法 id 时保持原样（即使该 preset 已被删除，
    // 也不在这里替换，交给解析层报 AGENT_PROFILE_UNKNOWN）。
    selections[surface] = text(source[surface]) || defaults[surface] || null;
  }
  return { schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION, selections };
}

/** 供 `GET /api/settings` 与响应体使用（只读副本）。 */
export function publicAgentSelections(settings) {
  return Object.fromEntries(AGENT_SURFACES.map(surface => [surface, settings.selections[surface] ?? null]));
}

/**
 * 校验一次 POST 的 `agentPresets` 片段。
 * - 只接受已登记的 surface；
 * - 只接受 Registry 中真实存在、且支持该 surface 的 preset；
 * - 允许只提交部分 surface（未提交的保持不变）。
 * @returns {Record<string, string>} 仅包含本次要修改的项
 */
export function validateAgentSelectionPatch(payload, { registry } = {}) {
  if (payload === undefined) return {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AgentSettingsError('agentPresets 必须是对象');
  if (!registry) throw new AgentSettingsError('Registry 不可用');
  const patch = {};
  for (const [surface, rawId] of Object.entries(payload)) {
    if (!AGENT_SURFACES.includes(surface)) throw new AgentSettingsError(`未知入口：${surface}`);
    const id = text(rawId);
    if (!id) throw new AgentSettingsError(`${surface} 不能为空`);
    let profile;
    try { profile = registry.resolve(id, surface); }
    catch (error) {
      const failure = new Error(error.message);
      failure.code = error.code;
      failure.status = 400;
      throw failure;
    }
    if (!profile.surfaces.includes(surface)) throw new AgentSettingsError(`${id} 不支持入口 ${surface}`);
    if (!AGENT_SURFACE_COMPATIBILITY[surface]) throw new AgentSettingsError(`未登记的入口：${surface}`);
    patch[surface] = id;
  }
  return patch;
}

/** 读取设置；文件缺失或损坏时回落到默认值，并如实说明原因（不抛错）。 */
export async function loadAgentSettings(path, { defaults = {} } = {}) {
  let source;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { ...normalizeAgentSettings(null, { defaults }), source: 'defaults', reason: 'missing' };
  }
  try {
    const parsed = JSON.parse(source);
    return { ...normalizeAgentSettings(parsed, { defaults }), source: 'file', reason: null };
  } catch {
    // 损坏内容不参与任何 persona 决策，只回落到默认映射并标记原因。
    return { ...normalizeAgentSettings(null, { defaults }), source: 'defaults', reason: 'corrupt' };
  }
}

/** 原子写入：临时文件 + rename，避免请求期间读到半写入内容。 */
export async function saveAgentSettings(path, settings) {
  await mkdir(dirname(path), { recursive: true });
  const payload = normalizeAgentSettings(settings, { defaults: settings?.selections || {} });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION, selections: payload.selections }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return payload;
}
