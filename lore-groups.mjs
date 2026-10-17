// 服务端可用的资料组入口。浏览器侧实现位于 dist/lore-groups.js（无构建步骤的经典脚本），
// 这里通过副作用导入把它挂到 globalThis，再以具名绑定导出，避免服务端与前端各写一份表。
import './dist/lore-groups.js';

const api = globalThis.WorldforgeLoreGroups;

export const FIXED_GROUPS = api.FIXED_GROUPS;
export const LEGACY_GROUPS = api.LEGACY_GROUPS;
export const MINIMAL_FIELDS = api.MINIMAL_FIELDS;
export const DEFAULT_FIELDS = api.DEFAULT_FIELDS;
export const FIELD_KINDS = api.FIELD_KINDS;
export const LEGACY_FIELD_LABELS = api.LEGACY_FIELD_LABELS;
export const PROMPT_GROUP_KEYS = api.PROMPT_KEYS;
export const IMAGE_PROMPT_GROUP_KEYS = api.IMAGE_KEYS;
export const MAX_LORE_GROUPS = api.MAX_GROUPS;
export const MAX_LORE_FIELDS = api.MAX_FIELDS;

export const normalizeLoreGroups = api.normalizeGroups;
export const normalizeStoredLoreGroups = api.normalizeStoredGroups;
export const allLoreGroups = api.allGroups;
export const deriveLoreGroups = api.deriveGroups;
export const groupsForWorld = api.groupsForWorld;
export const migrateLegacyGroups = api.migrateLegacyGroups;
export const loreGroupOf = api.groupOf;
export const promptKeyOf = api.promptKey;
export const fieldSchema = api.fieldSchema;
export const groupResponseSchema = api.groupResponseSchema;

/** 把客户端提交的组清洗成完整、安全的组对象（含字段与提示）。 */
export function sanitizeLoreGroup(value) {
  return api.normalizeGroup(value);
}

/** 未知/缺省的 type 回落到固定组的默认字段，绝不假设某个具体世界。 */
export function fallbackGroup(type) {
  const key = String(type || '').trim();
  const fixed = api.FIXED_GROUPS.find(group => group.id === key);
  if (fixed) return api.normalizeGroup(fixed);
  const legacy = api.LEGACY_GROUPS[key];
  if (legacy) return api.normalizeGroup({ id: key, ...legacy });
  return api.normalizeGroup(api.FIXED_GROUPS[0]);
}

/** 资料类型 → 生图档位：固定 id 直接用，旧类型按 form 归一。 */
export function imageKeyForId(type) {
  const key = String(type || '').trim();
  const fixed = api.FIXED_GROUPS.find(group => group.id === key);
  const legacy = api.LEGACY_GROUPS[key];
  return api.imageKey({ id: key, form: (fixed || legacy || {}).form || 'generic' });
}
