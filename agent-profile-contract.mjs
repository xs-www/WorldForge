// Agent Profile 契约真值（Sprint 0 固化，Sprint 1 的 Registry 直接 import）。
//
// 本模块只放纯常量与纯数据，不做文件系统、网络或环境访问：
// - 产品侧真值是 docs/schemas/agent-runtime.schema.json；
// - 本模块是代码侧真值，供 Registry、API 与测试共用，避免枚举在代码里被重写一遍；
// - 测试会校验两者一致，任何一侧单独改动都会失败。
//
// 边界：本模块不解析、不读取、也不执行 .agent-presets/<id>/agent.cordis.yml。

/** 投影清单结构版本，必须与 Schema 的 schemaVersion const 一致。 */
export const AGENT_RUNTIME_SCHEMA_VERSION = 1;

/** 产品侧投影清单文件名。产品只读这个文件与它声明的 systemPrompt。 */
export const AGENT_RUNTIME_MANIFEST = 'worldforge.runtime.json';

/** 仓库随附 preset 的固定根目录（相对仓库根）。产品不扫描用户 DSH 目录。 */
export const AGENT_PRESETS_DIRECTORY = '.agent-presets';

/** prompt 长度上限（字符）。见 ADR-0029 §8 与 AGENT_PROMPT_TOO_LARGE。 */
export const AGENT_PROMPT_MAX_CHARS = 32768;

/** 产品入口标识。每个 surface 独立保存默认 preset，没有全局选择。 */
export const AGENT_SURFACES = Object.freeze(['lore', 'free', 'card']);

/** 产品侧交互模式。 */
export const AGENT_MODES = Object.freeze(['structured_lore', 'free_chat', 'structured_card']);

/** 服务端白名单内的工具策略。preset 不能借此扩大轮次/调用/附图硬上限。 */
export const AGENT_TOOL_POLICIES = Object.freeze(['none', 'free_lore_readonly', 'card_context_readonly']);

/** 已登记输出契约名称。不接受文件路径或任意模块名。 */
export const AGENT_OUTPUT_CONTRACTS = Object.freeze(['lore_blocks_v2', 'free_chat_v1', 'card_patch_v1']);

/** 允许产出的内容状态：设定类只允许 proposed，卡牌类额外允许 untested。 */
export const AGENT_STATUS_POLICIES = Object.freeze(['proposed_only', 'proposed_or_untested']);

/**
 * 冻结的兼容矩阵：surface → 该 surface 唯一合法的 mode / outputContract / toolPolicy / statusPolicy。
 * 这就是 ADR-0029 §6 的表格，也是 Schema 三条 if/then 分支要表达的同一件事。
 */
export const AGENT_SURFACE_COMPATIBILITY = Object.freeze({
  lore: Object.freeze({ mode: 'structured_lore', outputContract: 'lore_blocks_v2', toolPolicy: 'none', statusPolicy: 'proposed_only' }),
  free: Object.freeze({ mode: 'free_chat', outputContract: 'free_chat_v1', toolPolicy: 'free_lore_readonly', statusPolicy: 'proposed_only' }),
  card: Object.freeze({ mode: 'structured_card', outputContract: 'card_patch_v1', toolPolicy: 'none', statusPolicy: 'proposed_or_untested' })
});

/**
 * 冻结的稳定错误码（ADR-0029 §9）。Registry 必须使用这些码，不得另起名字
 * 或把拒绝伪装成成功。
 */
export const AGENT_PROFILE_ERROR_CODES = Object.freeze([
  'AGENT_ROOT_UNREADABLE',
  'AGENT_MANIFEST_UNREADABLE',
  'AGENT_MANIFEST_INVALID',
  'AGENT_ENUM_UNKNOWN',
  'AGENT_ID_MISMATCH',
  'AGENT_COMPAT_MISMATCH',
  'AGENT_PROMPT_MISSING',
  'AGENT_PROMPT_PATH_UNSAFE',
  'AGENT_PROMPT_TOO_LARGE',
  'AGENT_PROFILE_UNKNOWN',
  'AGENT_PROFILE_INCOMPATIBLE'
]);

/**
 * 冻结的提示词层次（ADR-0029 §7），priority 越小优先级越高（1 最高）。
 * replaceableByPreset 为 true 的层**只有** preset_runtime；第 1、3 层由确定性
 * 代码拼装，preset 不能替换。Sprint 1/2 的拼装函数必须按本顺序产出层序列，
 * 不得重排；顺序回归由 tests/snapshots/agent-prompt-layers.json 保护。
 */
export const AGENT_PROMPT_LAYERS = Object.freeze([
  Object.freeze({ name: 'product_boundary', priority: 1, source: 'product', replaceableByPreset: false }),
  Object.freeze({ name: 'preset_runtime', priority: 2, source: 'preset', replaceableByPreset: true }),
  Object.freeze({ name: 'entry_contract', priority: 3, source: 'product', replaceableByPreset: false }),
  Object.freeze({ name: 'author_prompts', priority: 4, source: 'author', replaceableByPreset: false }),
  Object.freeze({ name: 'task_request', priority: 5, source: 'request', replaceableByPreset: false }),
  Object.freeze({ name: 'untrusted_context', priority: 6, source: 'request', replaceableByPreset: false })
]);

/** 允许被 preset 替换的层名（恰好一层）。 */
export const AGENT_PRESET_REPLACEABLE_LAYER = 'preset_runtime';

/**
 * 产品保留的分隔标记。preset 的 system.md 不得包含它们，
 * 否则可以在拼装后的提示里冒充产品边界或入口契约。
 */
export const AGENT_PROMPT_RESERVED_TAGS = Object.freeze(['<product_boundary>', '</product_boundary>', '<agent_preset>', '</agent_preset>', '<entry_contract>', '</entry_contract>']);

/**
 * 不可信内容标记（ADR-0029 §7 第 6 层）。它们只能出现在用户侧上下文里，
 * 不得进入 system / entry_contract —— 否则作者笔记与资料库正文会被提升为指令。
 */
export const AGENT_UNTRUSTED_TAGS = Object.freeze(['<author_notes>', '</author_notes>', '<library_context>', '</library_context>', '<worldforge_context>', '</worldforge_context>', '<worldforge_examples>', '</worldforge_examples>', '<untrusted_context>', '</untrusted_context>']);
