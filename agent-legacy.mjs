// Sprint 5 回滚基线（ADR-0029 §7、计划 §12.4）。
//
// `WORLDFORGE_AGENT_LEGACY_PROMPTS=1` 只更换 persona 来源，不改变安全能力边界：
// - 第 1 层产品安全边界、第 3 层入口契约、Schema、工具白名单、
//   轮次/调用上限与 canon/proposed 纪律全部沿用默认路径；
// - 仅第 2 层 `preset_runtime` 退回 `ai-harness.mjs` 里的代码内固定 persona。
// 因此回滚既不是「无约束直通」，也不会在 Registry 不可用时静默换用别的 persona：
// 默认路径仍然是启动失败，只有显式打开该开关才允许降级启动。

import { AGENT_RUNTIME_SCHEMA_VERSION, AGENT_SURFACES, AGENT_SURFACE_COMPATIBILITY } from './agent-profile-contract.mjs';

/** 只接受精确值 `1`：`true`/`yes`/空白都不打开回滚，避免误配把预设永久旁路。 */
export const LEGACY_PROMPTS_ENV = 'WORLDFORGE_AGENT_LEGACY_PROMPTS';
/** 供 `/api/health`、`/api/ai/presets` 与 `/api/settings` 说明当前 persona 来源。 */
export const LEGACY_PROMPT_SOURCE = 'legacy-fixed-prompts';
export const LEGACY_PRESET_ID = 'legacy-fixed-prompt';
export const LEGACY_PRESET_VERSION = '0.0.0-legacy';

export function legacyPromptsEnabled(env = process.env) {
  return String(env?.[LEGACY_PROMPTS_ENV] ?? '') === '1';
}

// 兼容矩阵仍然生效：回滚不放松任何入口的 mode / outputContract / toolPolicy / statusPolicy。
// `systemPrompt` 恒为空串，调用方据此不传 `presetPrompt`，第 2 层自然退回固定 persona。
const LEGACY_PROFILES = Object.freeze(Object.fromEntries(AGENT_SURFACES.map(surface => {
  const compatibility = AGENT_SURFACE_COMPATIBILITY[surface];
  return [surface, Object.freeze({
    id: LEGACY_PRESET_ID,
    version: LEGACY_PRESET_VERSION,
    hash: '',
    displayName: '固定提示（回滚模式）',
    description: '运维回滚开关已启用：使用代码内固定 persona，不读取任何 preset 提示词。',
    surfaces: Object.freeze([surface]),
    mode: compatibility.mode,
    outputContract: compatibility.outputContract,
    toolPolicy: compatibility.toolPolicy,
    statusPolicy: compatibility.statusPolicy,
    systemPrompt: '',
    legacy: true
  })];
})));

const LEGACY_DEFAULTS = Object.freeze(Object.fromEntries(AGENT_SURFACES.map(surface => [surface, LEGACY_PRESET_ID])));

/** 回滚模式的 profile：字段与 Registry profile 同形，但 `legacy: true` 且没有提示词正文。 */
export function legacyProfile(surface) {
  const profile = LEGACY_PROFILES[surface];
  if (!profile) {
    const error = new Error(`未登记的 surface：${surface}`);
    error.code = 'AGENT_PROFILE_INCOMPATIBLE';
    error.status = 400;
    throw error;
  }
  return profile;
}

/** 响应里回显的 preset 快照：版本明确标为 legacy，哈希保持空串。 */
export function legacyAgentSnapshot(surface) {
  const { id, version, hash, mode } = legacyProfile(surface);
  return { presetId: id, presetVersion: version, presetHash: hash, mode };
}

export function legacyDefaults() {
  return { ...LEGACY_DEFAULTS };
}

/**
 * `/api/health` 的降级报告：与 `registryHealthSummary` 同形，额外标注 `degraded` 与来源，
 * 让前端与运维一眼看出「服务在跑，但 Agent Registry 不可用」，而不是误以为配置丢失。
 */
export function legacyRegistryHealth(failure = null) {
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    count: 0,
    countBySurface: Object.fromEntries(AGENT_SURFACES.map(surface => [surface, 0])),
    ids: [],
    diagnostics: failure ? [{ code: failure.code || 'AGENT_PROFILE_UNKNOWN', message: failure.message || 'Agent Registry 不可用' }] : [],
    degraded: true,
    promptSource: LEGACY_PROMPT_SOURCE
  };
}

/**
 * `/api/ai/presets` 在回滚模式下保持既有结构（`schemaVersion`/`presets`/`defaults`），
 * 额外带 `fallback`：`presets` 为空是「当前不按 preset 解析」，不是「Registry 目录为空」。
 */
export function legacyPresetsView() {
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    presets: [],
    defaults: legacyDefaults(),
    fallback: LEGACY_PROMPT_SOURCE
  };
}
