// 卡牌文字 Agent 的受限契约（Sprint 4）：只接受字段补丁。
// 所有校验都在服务端、返回浏览器之前完成；AI 不能保存、不能改 canon、不能调用图像生成。
// 2026-10-17 作者裁定：卡牌评审由作者完成，Agent 不再产出 review 字段（见 ADR-0029 变更记录）。

import { coerceVariants, parseLooseJson, previewOf, withFallbackKey } from './ai-harness.mjs';

const TEXT = { name: 100, rulesText: 2000, listItem: 500, note: 300, statement: 1200 };
export const CARD_FIELDS = Object.freeze(['name', 'cost', 'type', 'rarity', 'attack', 'health', 'durability', 'tribeId', 'spellSchoolId', 'keywordIds', 'effects', 'rulesText', 'notes', 'loreRefs']);
export const CARD_TYPES = Object.freeze(['minion', 'spell', 'equipment']);
export const CARD_RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary']);
export const CARD_ACTIONS = Object.freeze(['brainstorm', 'polish', 'close_rules', 'tune_stats', 'align_lore']);
const EFFECT_OPS = Object.freeze(['deal_damage', 'heal', 'draw_card']);
const MAX_VARIANTS = 3;
const BALANCE_CLAIMS = /已平衡|平衡已验证|已验证平衡|经过仿真验证/;

const TYPE_STATS = Object.freeze({
  minion: Object.freeze(['attack', 'health']),
  spell: Object.freeze([]),
  equipment: Object.freeze(['attack', 'durability'])
});

function text(value, limit) { return String(value ?? '').trim().slice(0, limit); }
function textList(value, limit, maxItems) { return (Array.isArray(value) ? value : []).map(item => text(item, TEXT.listItem)).filter(Boolean).slice(0, maxItems); }

/** 由勾选字段与候选数生成严格 Schema；未勾选字段不能出现在 patch 中。 */
export function createCardResponseSchema(payload = {}) {
  const fields = (Array.isArray(payload.selectedFields) ? payload.selectedFields : []).filter(field => CARD_FIELDS.includes(field));
  const count = Math.min(MAX_VARIANTS, Math.max(1, Number(payload.variantCount) || 1));
  const patchProperties = {
    name: { type: 'string' },
    cost: { type: 'number' },
    type: { enum: [...CARD_TYPES] },
    rarity: { enum: [...CARD_RARITIES] },
    attack: { type: 'number' },
    health: { type: 'number' },
    durability: { type: 'number' },
    tribeId: { type: 'string' },
    spellSchoolId: { type: 'string' },
    keywordIds: { type: 'array', items: { type: 'string' } },
    effects: { type: 'array', items: { type: 'object' } },
    rulesText: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    loreRefs: { type: 'array', items: { type: 'string' } }
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'patch'],
          properties: {
            key: { type: 'string' },
            patch: { type: 'object', additionalProperties: false, required: [], properties: Object.fromEntries(fields.map(field => [field, patchProperties[field]])) }
          }
        }
      }
    }
  };
}

function assertString(value, path, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${path} 必须是非空字符串`);
  return value.trim();
}

/** 校验单个候选；抛错即为不合法候选（会被转成诊断）。 */
export function validateCardVariant(variant, payload = {}) {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new Error('候选必须是对象');
  const key = assertString(variant.key, 'key', 80);
  const allowedFields = new Set((Array.isArray(payload.selectedFields) ? payload.selectedFields : []).filter(field => CARD_FIELDS.includes(field)));
  const patch = variant.patch && typeof variant.patch === 'object' && !Array.isArray(variant.patch) ? variant.patch : {};
  const unknownFields = Object.keys(patch).filter(field => !allowedFields.has(field));
  if (unknownFields.length) throw new Error(`候选写入了未勾选字段：${unknownFields.join('、')}`);

  const normalized = {};
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'name') normalized.name = assertString(value, 'patch.name', TEXT.name);
    else if (field === 'rulesText') normalized.rulesText = assertString(value, 'patch.rulesText', TEXT.rulesText);
    else if (field === 'type') { if (!CARD_TYPES.includes(value)) throw new Error('patch.type 不是合法卡牌类型'); normalized.type = value; }
    else if (field === 'rarity') { if (!CARD_RARITIES.includes(value)) throw new Error('patch.rarity 不是合法稀有度'); normalized.rarity = value; }
    else if (['cost', 'attack', 'health', 'durability'].includes(field)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99) throw new Error(`patch.${field} 必须是 0–99 的数值`);
      normalized[field] = Math.round(value);
    } else if (field === 'tribeId' || field === 'spellSchoolId') normalized[field] = text(value, 60);
    else if (field === 'keywordIds') {
      const ids = textList(value, 100, 12);
      const allowed = new Set(Array.isArray(payload.allowedKeywordIds) ? payload.allowedKeywordIds : []);
      const unknown = ids.filter(id => !allowed.has(id));
      if (unknown.length) throw new Error(`未提供的关键词 ID：${unknown.join('、')}`);
      normalized.keywordIds = ids;
    } else if (field === 'loreRefs') {
      const ids = textList(value, 100, 12);
      const allowed = new Set(Array.isArray(payload.allowedLoreIds) ? payload.allowedLoreIds : []);
      const unknown = ids.filter(id => !allowed.has(id));
      if (unknown.length) throw new Error(`未提供的设定 ID：${unknown.join('、')}`);
      normalized.loreRefs = ids;
    } else if (field === 'effects') {
      const effects = Array.isArray(value) ? value.slice(0, 8) : [];
      for (const effect of effects) {
        if (!effect || typeof effect !== 'object' || Array.isArray(effect)) throw new Error('effects 项必须是对象');
        const op = String(effect.op || '');
        if (!EFFECT_OPS.includes(op)) throw new Error(`未登记的效果操作：${op || '（空）'}`);
        const params = effect.params === undefined ? {} : effect.params;
        if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new Error('effects.params 必须是对象');
        const serialized = JSON.stringify(params);
        if (/[;=]|[a-z_$][\w$]*\s*\(/i.test(serialized)) throw new Error('effects.params 不能包含脚本或表达式');
      }
      normalized.effects = effects.map(effect => ({ op: String(effect.op), params: { ...(effect.params || {}) } }));
    } else if (field === 'notes') normalized.notes = textList(value, TEXT.note, 8);
  }

  // 类型互斥：先看 patch 自身，再与草案现状合并判断。
  const draft = payload.draft && typeof payload.draft === 'object' ? payload.draft : {};
  const type = normalized.type || draft.type || 'minion';
  const has = field => Object.prototype.hasOwnProperty.call(normalized, field);
  if (type === 'spell' && (has('attack') || has('health') || has('durability'))) throw new Error('法术不能包含 attack/health/durability');
  if (type === 'equipment' && (has('health') || has('tribeId') || has('spellSchoolId'))) throw new Error('武器不能包含 health、tribeId 或 spellSchoolId');
  if (type === 'minion' && (has('durability') || has('spellSchoolId'))) throw new Error('随从不能包含 durability 或 spellSchoolId');
  if (type !== 'minion' && has('tribeId')) throw new Error('只有随从能写 tribeId');
  if (type !== 'spell' && has('spellSchoolId')) throw new Error('只有法术能写 spellSchoolId');
  const allowedStats = TYPE_STATS[type];
  for (const field of ['attack', 'health', 'durability']) {
    if (has(field) && !allowedStats.includes(field)) throw new Error(`${type} 不允许 patch.${field}`);
  }

  const claimSurface = [normalized.rulesText || '', ...(normalized.notes || [])].join('\n');
  if (BALANCE_CLAIMS.test(claimSurface)) throw new Error('不得声称数值已平衡或经过仿真验证');

  // 数值字段一律附 untested 标记，避免候选被当成已测结论。
  const numeric = ['cost', 'attack', 'health', 'durability'].some(has);
  const notes = normalized.notes || [];
  if (numeric && !notes.some(note => /untested|未经测试/i.test(note))) notes.unshift('数值未经测试（untested）');
  if (notes.length || has('notes')) normalized.notes = notes;

  return { key, patch: normalized };
}

/** 逐候选校验并收集诊断；结构损坏也不抛到路由层。 */
export function inspectCardResponse(raw, payload = {}, stage = 'initial') {
  const value = typeof raw === 'string' ? parseLooseJson(raw) : raw;
  if (value === undefined) {
    return { variants: [], issues: [{ stage, index: null, code: 'INVALID_JSON', message: '模型没有返回有效 JSON', preview: previewOf(raw) }] };
  }
  const envelope = coerceVariants(value, ['patch']);
  if (!envelope) {
    return { variants: [], issues: [{ stage, index: null, code: 'INVALID_ENVELOPE', message: '返回值缺少 variants 数组', preview: previewOf(value) }] };
  }
  const variants = [], issues = [], keys = new Set();
  envelope.variants.forEach((candidate, index) => {
    const normalized = withFallbackKey(candidate, index);
    try {
      const validated = validateCardVariant(normalized, payload);
      if (keys.has(validated.key)) throw new Error(`候选 key 重复：${validated.key}`);
      keys.add(validated.key);
      variants.push(validated);
    } catch (error) {
      issues.push({ stage, index, code: 'INVALID_VARIANT', message: error.message, preview: String(normalized?.key || '') });
    }
  });
  return { variants, issues };
}

/** 初次验收 + 一次差额补生成；与设定助手同构，便于观察同样的诊断字段。 */
export async function completeCardVariants({ raw, payload = {}, expectedCount, requestSupplement } = {}) {
  const wanted = Math.min(MAX_VARIANTS, Math.max(1, Number(expectedCount) || 1));
  const initial = inspectCardResponse(raw, payload, 'initial');
  const variants = initial.variants.slice(0, wanted);
  const issues = [...initial.issues];
  let supplementalRequested = 0, supplementalAccepted = 0;
  if (variants.length < wanted) {
    supplementalRequested = wanted - variants.length;
    issues.push({ stage: 'initial', index: null, code: 'INSUFFICIENT_VARIANTS', message: `初次仅验收 ${variants.length}/${wanted} 条，将只补充剩余 ${supplementalRequested} 条` });
    if (typeof requestSupplement === 'function') {
      try {
        const supplementRaw = await requestSupplement({ missingCount: supplementalRequested, acceptedVariants: variants, issues });
        const supplement = inspectCardResponse(supplementRaw, payload, 'supplement');
        issues.push(...supplement.issues);
        const keys = new Set(variants.map(item => item.key));
        for (const candidate of supplement.variants) {
          if (variants.length >= wanted) break;
          if (keys.has(candidate.key)) { issues.push({ stage: 'supplement', index: null, code: 'DUPLICATE_VARIANT', message: `补充候选 key 重复：${candidate.key}` }); continue; }
          keys.add(candidate.key); variants.push(candidate); supplementalAccepted += 1;
        }
      } catch (error) {
        issues.push({ stage: 'supplement', index: null, code: 'SUPPLEMENT_FAILED', message: `补充生成失败：${error.message}` });
      }
    }
  }
  return {
    variants,
    diagnostics: {
      status: variants.length === wanted ? 'complete' : 'partial',
      requestedCount: wanted,
      initialAcceptedCount: initial.variants.length,
      supplementalRequested,
      supplementalAccepted,
      finalCount: variants.length,
      issues
    }
  };
}
