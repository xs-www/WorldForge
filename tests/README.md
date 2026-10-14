# Tests

此目录用于保存结构校验、规则示例与卡牌交互测试。当前尚未建立正式 timing specification。

- `ai-harness.test.mjs`：验证 AI 上下文、13 类内容块契约、部分字段动态 Schema、自由文本请求格式与名称生成响应。
- `subpath-routing.test.mjs`：验证浏览器 API 请求跟随脚本挂载路径，避免 `/worldforge` 反向代理下回落到站点根路径。
- `storage.test.mjs`：使用临时 SQLite 数据库验证结构化内容（含故事关联）持久化、健康检查、重复 ID 拒绝、revision 冲突保护、有序 Schema 迁移、v1 数据保留升级与未来版本拒绝。
- `world-package.test.mjs`：验证 JSON 发布筛选、事实层次分区、引用完整性、机制参数/缺失/循环/版本依赖、确定性包哈希，以及独立 SQLite 世界实例化。
- `simulation-runtime.test.mjs`：验证 M1 三种能源行动、确定性冲突、资源守恒、状态版本、知识隔离/过期、拒绝信息过滤，以及从 Tick 0 快照重放。
- `geography.test.mjs`：验证大陆到国家再到地点的层级树、搜索时保留完整祖先路径、无效父级隔离与跨世界父级拒绝。
- `chronicle.test.mjs`：验证编年史容器与节点分组、数值纪年排序、搜索保留容器、无效父级隔离与跨世界拒绝。
- `cards.test.mjs`：验证旧卡牌类型迁移、稀有度与多来源规范化，以及设定条目到卡牌三分类的默认映射。
- `prompt-settings.test.mjs`：验证 13 类默认提示词、个性化提示、分类微调及非法分类/长度拒绝。
- `seedream.test.mjs`：验证火山方舟请求边界、固定参数与临时 URL 图片下载，不发起真实付费调用。
- `comfyui.test.mjs`：验证 API Format 工作流占位符、任务入队、历史轮询与结果下载。
