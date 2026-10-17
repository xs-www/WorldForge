// 服务端可用的资料组入口。浏览器侧实现位于 dist/lore-groups.js（无构建步骤的经典脚本），
// 这里通过副作用导入把它挂到 globalThis，再以具名绑定导出，避免两张表各写一份。
import './dist/lore-groups.js';

const api = globalThis.WorldforgeLoreGroups;

export const FIXED_GROUPS = api.FIXED_GROUPS;
export const LEGACY_GROUPS = api.LEGACY_GROUPS;
export const PROMPT_GROUP_KEYS = api.PROMPT_KEYS;
export const MAX_LORE_GROUPS = api.MAX_GROUPS;

export const normalizeLoreGroups = api.normalizeGroups;
export const allLoreGroups = api.allGroups;
export const deriveLoreGroups = api.deriveGroups;
export const loreGroupOf = api.groupOf;
export const promptKeyOf = api.promptKey;

/** 把客户端提交的单个资料组清洗成可用于提示词与 Schema 的安全描述。 */
export function sanitizeLoreGroup(value) {
  const group = api.normalizeGroup(value);
  if (!group) return null;
  return { id: group.id, label: group.label, form: group.form, attributes: group.attributes, custom: group.custom };
}
