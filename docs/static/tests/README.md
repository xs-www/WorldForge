# `tests/` — 测试套件总览

> 作用：零依赖 `node:test` 套件，一个 `*.test.mjs` 对应一组契约或回归点；也是本仓库唯一防止「canon 纪律 / 提示边界 / 镜像闭包 / 模拟确定性」被静默破坏的自动化关卡。

## 测试文件
| 测试文件 | 覆盖的契约 / 回归点 | 关键手法 |
| --- | --- | --- |
| `agent-loop.test.mjs` | 工具循环：无工具即答、查条目后再答、trace 摘要、畸形参数与未知工具回灌而非抛错、工具预算与轮次上限强制收尾、`chat`/`responses` 两种线格式、图片附件按轮上限与「模型拒绝图片时降级一次」、provider 错误保留 HTTP 状态 | 注入假 `callModel` / `fakeFetch`，断言请求体与循环行为 |
| `agent-presets.test.mjs` | 三个 DSH preset 自包含（不引用仓库外路径）、`card-designer` 能力边界窄化、三个 persona 的提示契约互不相同 | 直接读 `agent.cordis.yml`/`preset.yml`/`SKILL.md` 文本做断言，不起服务 |
| `agent-profile-api.test.mjs` | `GET /api/ai/presets` 只返回脱敏元数据与 `defaults`；损坏投影、符号链接 preset、缺入口、重复 ID 均**拒绝启动**；镜像只带 6 个投影文件；部署的 schema 与设计树一致 | 真实 `server.mjs` 子进程 + 临时目录 + 空闲端口 + `symlink` 夹具 |
| `agent-profile-contract.test.mjs` | 冻结枚举与 `additionalProperties:false`、三 preset 与兼容矩阵、`tests/fixtures/agent-profiles/` 合法/拒绝夹具、prompt 路径不越 preset 根、代码常量 vs schema vs ADR、提示层顺序 vs 快照 | 读盘遍历 + 夹具逐目录断言错误码 |
| `agent-profile-registry.test.mjs` | Registry 完整性门：每个声明的错误码都必须**真被产出**、深冻结（嵌套数组不可写）、指纹确定性且随清单/提示变化、投影不泄露、路径逃逸与符号链接拒绝、缺 preset 拒绝启动 | 临时 preset 根 + 复制 shipped 投影 + `symlink` + 篡改清单 |
| `agent-prompt-layers.test.mjs` | 六层提示按 1→2→3 / 4→5→6 各自递增且两通道互不串层、**补生成请求同样保持 4→5→6**（不出现 4→5→6→6→5）、**补生成沿用 `variantCount=missingCount` 且第 4 层与初次一致**、**`requireJson` 的 JSON 指令位于第 5 层且 prompt 以第 6 层结尾**、preset 不能伪造产品层、作者注记与库文本进不了指令层、不可信上下文只挂最后一条 user 消息、产品侧投影只含第 2 层 | 纯函数组合 + 保留标记与不可信标记注入夹具 |
| `agent-settings-api.test.mjs` | 按 surface 保存的默认 preset：默认/部分更新/原子写入、未知 surface 或跨入口或未知 id 一律 400 且不写盘、损坏文件回落 `corrupt`、保存值驱动请求、请求快照覆盖保存值、伪造版本/哈希不被采信、重启后仍生效、已保存 preset 消失时报 `AGENT_PROFILE_UNKNOWN` 而不自动改选 | 临时 preset 根（两个 lore preset）+ 真实 `server.mjs` + 本地假模型 |
| `agent-settings-ui.test.mjs` | 设置页三个按 surface 过滤的选择器与 `aria-describedby`/`role="alert"`、`agentPresets` 随设置一起提交、自由对话的选择器与 chip、切换前确认并开新对话、两个入口都发送 `presetId`、preset 错误与模型错误分开呈现 | 静态扫描 `dist/index.html`、`dist/app.js`、`dist/styles.css` |
| `agent-surface-integration.test.mjs` | 三个入口服务端**实际发出**的提示层次（含第二次补生成请求的完整层序）、**补生成第 4 层逐字一致且数量要求与 Schema 的 `minItems/maxItems` 对齐**、**带 `response_format` 的请求返回 400 时三条降级分支仍保持 4→5→6**、preset 快照权威性、非法/跨入口 preset 在模型调用前失败、preset 不能放宽服务端硬限制、system 不含不可信正文 | 真实 `server.mjs` 子进程 + 本地假模型 HTTP 服务记录每次请求；`prompt-settings.json` 预置作者提示以检出第 4 层丢失 |
| `agent-tools.test.mjs` | 只读、命名空间化的工具集：`search_lore`/`get_lore_entry`/`list_lore`、art 资产工具、过滤与 limit 夹取、超长输出显式裁剪、未知工具与坏参数可恢复 | 内存 library 直接调 `runToolCall`，不联网 |
| `ai-harness.test.mjs` | 上下文取证（同世界 canon 优先、异世界隔离）、13 类内容块契约、动态 Schema、逐候选校验与「只补缺」、部分失败仍返回可见诊断 | 纯函数 + 可注入的补全实现 |
| `card-battle.test.mjs` | 同种子洗牌确定、费用与入场攻击限制、关键词（疾启/护持/隔绝/余响）语义、规则 AI 回合有界、未知关键词与任意 effect 不可执行 | `import '../dist/battle.js'` 后读 `globalThis.WorldforgeBattle` |
| `cards.test.mjs` | 旧卡牌类型迁移、稀有度与 `lore_refs` 规范化、三类型 `stats` 语义、`tribe`/`spell_school` 互斥与未知 id 丢弃、富文本标记编译顺序、十一个法术派系分档 | `dist/cards.js` 纯函数 |
| `chronicle.test.mjs` | 编年史容器与节点分组、显式顺序排序、搜索保留父容器、无效父级隔离 | `dist/chronicle.js` 纯函数 |
| `comfyui.test.mjs` | API Format 工作流必须含 `{{PROMPT}}` 占位、数值占位保留类型、入队/历史轮询/结果下载 | 模板对象 + mock `fetch` |
| `docker-packaging.test.mjs` | `Dockerfile` 白名单 `COPY` 必须覆盖 `server.mjs` 的静态 import 闭包；镜像仍排除设计目录与密钥 | 正则解析 `Dockerfile` 的 `COPY` 行 + 递归遍历 `from './x.mjs'` |
| `geography.test.mjs` | 大陆→国家→地点层级、搜索保留完整祖先路径、无效父级隔离 | `dist/geography.js` 纯函数 |
| `image-context.test.mjs` | 卡面生图上下文沿 `lore_refs`/直接关系/关联故事扩展；设定条目视觉原型命中对应提示类目 | `image-context.mjs` + `prompt-settings.mjs` 组合调用 |
| `macro-simulation.test.mjs` | W98 12 地区/3 政体初态不入 canon、季度演化确定性与历史重放、局部提案上下文受限且仍受规则校验 | 临时 SQLite（`mkdtemp` + `node:sqlite`） |
| `prompt-settings.test.mjs` | 13 类默认提示齐全、个性化与分类微调被保留、未知分类与超长内容被拒 | 纯函数 `normalize/validatePromptSettings` |
| `reference-assets.test.mjs` | 参考图上传的 target/type/本地大小边界、id 去重、转 data URL | `reference-assets.mjs` 纯函数 |
| `relation-picker.test.mjs` | 当前条目不进入自身候选池、默认同世界且可跨世界、类型/状态/视图过滤组合、选择顺序保持、悬空 id 报告 | 先 import `dist/world-scope.js` 再 import `dist/relation-picker.js`，读 `globalThis` |
| `seedream.test.mjs` | 火山方舟边界（baseUrl 域名、尺寸、非空提示）、固定参数（`response_format:url`、无水印）、临时 URL 图片下载 | mock `fetch`，不产生付费调用 |
| `simulation-dashboard.test.mjs` | W99 实验观察数据不入 canon、三种可发现 Action 与受控提案、过期版本拒绝、能源守恒、审计与逐主体知识差异、可复现重置 | 临时 SQLite 上的规则主体全量推演 |
| `simulation-runtime.test.mjs` | M1 三种能源行动、Action/Effect 与知识策略越权拒绝、同 tick 冲突确定性、资源守恒、版本号与知识过期、拒绝信息不含隐藏储量、从 Tick 0 重放 | 临时 SQLite + 世界包实例化 |
| `storage.test.mjs` | 结构化内容持久化、`revision` 冲突与重复 ID 拒绝、有序迁移上报、v1 库升级不丢内容、未来版本拒绝、资产解绑/回绑不丢文件记录 | 临时 SQLite（`DatabaseSync`） |
| `subpath-routing.test.mjs` | `/worldforge` 子路径挂载下 API 前缀与静态资源不回落到站点根、卡牌库/原画集/编辑器互斥、自由聊天每轮快照参考材料、原画按稳定 asset id 命名、生图空响应不重复付费 | 断言 `dist/` 内页面结构、脚本与路由字符串，不打网络 |
| `world-package.test.mjs` | 发布筛选与真值分层、缺失引用拒绝、机制注册表（版本/参数/依赖顺序/环/不兼容版本）、契约访问路径参与包哈希、仓库内 JSON 清单确定性编译、实例化到独立 SQLite、schema v2 从 M0B 库升级并回填 | 复用已签入的真实清单 + 临时 SQLite |
| `world-scope.test.mjs` | 按 `worldId` 分组且世界条目为组头、孤立 `worldId` 进「未分配」而非消失、缺 `worldId` 回落默认世界、`nextWorldId` 取最小空位、搜索字段、`reassign` 只移动非世界条目并报数 | `dist/world-scope.js` 纯函数 |

## 共享约定
- 运行方式：仓库根执行 `node --test tests/*.test.mjs`（`npm run check` 的最后一步）。测试运行器为每个文件起子进程，且 `agent-profile-api` / `agent-surface-integration` 会再 `spawn` `server.mjs` 并占用临时端口——因此需要**子进程 spawn 与本地监听权限**，无网络的沙箱会失败。
- `tests/fixtures/agent-profiles/legal/`（`fixture-card`/`fixture-free`/`fixture-lore`）是三个可加载的合法投影；`reject/` 是十份单点缺陷夹具（`absolute-path`、`directory-mismatch`、`duplicate-id`、`empty-prompt`、`incompatible-combination`、`missing-prompt`、`oversized-prompt`、`traversal`、`unknown-enum`、`unknown-field`），每份应只触发自己的稳定错误码。
- `tests/snapshots/agent-prompt-layers.json` 冻结六层提示的 `name`/`priority`/`source`/`replaceableByPreset`；顺序变动必须是一次有意识的修改，并同步 ADR-0029 §7 与快照（`agent-profile-contract.test.mjs` 会同时比对代码常量、快照与 ADR）。
