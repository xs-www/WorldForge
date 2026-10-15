# Tests

此目录用于保存结构校验、规则示例与卡牌交互测试。当前尚未建立正式 timing specification。

- `ai-harness.test.mjs`：验证 AI 上下文、13 类内容块契约、精确数量动态 Schema、逐候选校验、仅补齐缺少候选、部分失败诊断、自由文本请求格式与名称生成响应。
- `subpath-routing.test.mjs`：验证浏览器 API 请求跟随脚本挂载路径、静态资源缓存版本、自由创作关键样式、AI 候选诊断、卡牌库/原画集/编辑器互斥结构、PNG 卡面编译入口、富文本 Canvas 字体与属性名隐藏，以及原画 ID 下载响应、生图空响应解析、请求 ID资产找回和禁止自动重复付费请求，避免 `/worldforge` 反向代理下回落到站点根路径。
- `storage.test.mjs`：使用临时 SQLite 数据库验证结构化内容（含故事关联）持久化、健康检查、重复 ID 拒绝、revision 冲突保护、有序 Schema 迁移、v1 数据保留升级与未来版本拒绝。
- `world-package.test.mjs`：验证 JSON 发布筛选、事实层次分区、引用完整性、机制参数/缺失/循环/版本依赖、Action/Effect 契约、访问路径、确定性包哈希，以及独立 SQLite 世界实例化。
- `simulation-runtime.test.mjs`：验证 M1 三种能源行动、Action 参数契约、越权 Effect/知识策略拒绝、确定性冲突、资源守恒、状态版本、知识隔离/过期、拒绝信息过滤，以及从 Tick 0 快照重放。
- `simulation-dashboard.test.mjs`：验证 M2A W99 观察数据、三种可发现 Action、受控 Action 提案、过期版本拒绝、能源守恒、审计和逐主体知识差异，以及规则主体全量推演、历史重放和可复现重置。
- `macro-simulation.test.mjs`：验证 M2B W98 12 地区/3 政体初态、确定性季度演化、年度边界事件、历史重放、可复现重置，以及局部上下文与 LLM/规则提案的越区拒绝。
- `geography.test.mjs`：验证大陆到国家再到地点的层级树、搜索时保留完整祖先路径、无效父级隔离与跨世界父级拒绝。
- `chronicle.test.mjs`：验证编年史容器与节点分组、数值纪年排序、搜索保留容器、无效父级隔离与跨世界拒绝。
- `cards.test.mjs`：验证旧卡牌类型迁移、稀有度与多来源规范化、随从/法术/武器属性语义、关键词描述编译顺序、有限粗体/斜体标记与未知 HTML 纯文本保留，以及设定条目到卡牌三分类的默认映射。
- `prompt-settings.test.mjs`：验证 13 类默认提示词、个性化提示、分类微调及非法分类/长度拒绝。
- `seedream.test.mjs`：验证火山方舟请求边界、固定参数与临时 URL 图片下载，不发起真实付费调用。
- `comfyui.test.mjs`：验证 API Format 工作流占位符、任务入队、历史轮询与结果下载。
