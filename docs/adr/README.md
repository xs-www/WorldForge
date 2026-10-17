# ADR 索引

- [ADR-0001：卡牌基础信息与显示位置](ADR-0001-card-surface-baseline.md) — canon
- [ADR-0002：关键词引用可携带卡牌级附加说明](ADR-0002-keyword-usage-detail.md) — canon
- [ADR-0003：导入 W01 设定集 V0.1](ADR-0003-w01-v0.1-baseline.md) — canon
- [ADR-0004：使用 SQLite 持久化创作内容](ADR-0004-sqlite-content-persistence.md) — canon
- [ADR-0005：卡面候选图采用 Seedream / ComfyUI 双通道](ADR-0005-card-art-generation.md) — canon
- [ADR-0006：将背景故事作为独立可关联资料](ADR-0006-background-stories.md) — canon
- [ADR-0007：卡牌三分类、稀有度与设定来源联动](ADR-0007-card-types-rarity-lore-linkage.md) — canon
- [ADR-0008：作者工作区与世界定义包的发布边界](ADR-0008-authoring-definition-boundary.md) — canon（技术边界）
- [ADR-0009：内容库显式迁移与模拟域命名边界](ADR-0009-content-schema-migrations.md) — canon（技术边界）
- [ADR-0010：发布清单与 World Package 使用 JSON 契约](ADR-0010-json-world-package-contract.md) — canon（技术边界）
- [ADR-0011：M1 使用确定性 Tick、统一效果结算与主体知识日志](ADR-0011-deterministic-m1-runtime.md) — canon（技术边界）
- [ADR-0012：发布 Action/Effect 契约并限制机制状态访问](ADR-0012-action-effect-contracts.md) — canon（技术边界）
- [ADR-0013：以 W99 实验 API 与观察台公开首个模拟界面](ADR-0013-experimental-simulation-dashboard.md) — canon（技术边界）
- [ADR-0014：用有界规则主体跑通 W99 完整模拟闭环](ADR-0014-bounded-rule-agent-full-run.md) — canon（技术边界）
- [ADR-0015：宏观规则演化与局部 LLM 提案分层](ADR-0015-macro-rules-local-llm.md) — canon（技术边界）
- [ADR-0016：卡牌类型数值与描述编译顺序](ADR-0016-card-type-stats-and-description-compilation.md) — canon
- [ADR-0017：随从种族与法术派系的卡面字段](ADR-0017-minion-tribe-and-spell-school.md) — canon（技术边界），种族词表为 proposed
- [ADR-0018：编辑器预览与编译卡面共用几何，原画集覆盖全量素材](ADR-0018-preview-parity-and-full-artwork-gallery.md) — canon（技术边界）
- [ADR-0019：世界观模块改为「世界列表 → 世界内资料」两级结构](ADR-0019-world-hub-two-level-navigation.md) — canon（技术边界）
- [ADR-0020：关联资料改用可过滤的分栏选择窗口](ADR-0020-filtered-relation-picker.md) — canon（技术边界）
- [ADR-0021：选择窗口复用于卡牌设定来源与自由创作参考资料](ADR-0021-shared-picker-targets.md) — canon（技术边界）
- [ADR-0022：自由创作 Agent 获得多轮只读资料工具](ADR-0022-free-agent-lore-tools.md) — canon（技术边界）
- [ADR-0023：自由创作 Agent 可以查看美术资产](ADR-0023-agent-art-vision.md) — canon（技术边界）
- [ADR-0024：自由创作可附加素材库图片，对话按轮快照参考资料](ADR-0024-free-chat-attachments-and-context-preview.md) — canon（技术边界）
- [ADR-0025：正史约束从提示词移到监督点](ADR-0025-canon-constraint-placement.md) — canon（技术边界）
- [ADR-0026：美术资产可以解除绑定](ADR-0026-art-asset-unbind.md) — canon（技术边界）
- [ADR-0027：AI 设定助手浮动化，候选可覆盖当前条目，候选数可为 1](ADR-0027-ai-assistant-dock-and-overwrite.md) — canon（技术边界）
- [ADR-0028：以 W97 合成套牌建立实验对战纵切](ADR-0028-experimental-card-battle.md) — canon（技术边界），对战规则与关键词仍为 experimental
- [ADR-0029：产品内 Agent Profile 使用只读产品投影，不执行 DSH 组装](ADR-0029-agent-profile-runtime-projection.md) — canon（技术边界），§10 五项已由作者逐条签字接受
- [ADR-0030：以本机账号体系支撑 Tailscale Funnel 公网发布](ADR-0030-local-accounts-and-public-funnel.md) — canon（技术边界），共享工作区 + admin/member + 每人每日配额
- [ADR-0031：以「五项固定资料组 + 作者自定义组」取代十三类固定类型](ADR-0031-lore-groups-and-no-default-world.md) — canon（产品接口），同时移除默认世界种子；0.3.2 起固定组追加「设定」（见 ADR-0033 §12）
- [ADR-0032：作者资料库支持 PostgreSQL，并提供整库导入/导出](ADR-0032-postgres-content-store-and-data-transfer.md) — canon（技术边界），pg 仅在 postgres 驱动下动态加载
- [ADR-0033：以「分段解析 + 预览确认」把长篇设定导入为新世界](ADR-0033-lore-text-import.md) — proposed（产品接口），待作者裁定；导入永远只产出 proposed
- [ADR-0034：卡牌与原画按世界归属，测试对战/世界模拟标注 Beta](ADR-0034-world-scoped-cards-and-art.md) — proposed（产品接口），卡牌必须选世界，原画按绑定目标继承世界

新增提案请使用 `templates/adr.md`，后续编号从 `ADR-0035` 开始。
