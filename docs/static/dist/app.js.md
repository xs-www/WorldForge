# `dist/app.js`

> 作用：前端唯一的组合根。持有全部可变 UI 状态、把 `localStorage` 缓存与 `PUT api/content` 同步起来，并驱动世界观、卡牌、自由创作、W99 模拟诊断四个模块的 DOM 渲染与事件绑定。不向 `window` 导出任何符号（各子脚本反向被它调用）。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `NOTE_KEY` / `CARD_KEY` / `KEYWORD_KEY` / `LORE_KEY` / `PREF_KEY` | 8 个 `localStorage` 键中的 5 个；正文四键进 `CONTENT_KEYS`，`PREF_KEY` 仅本浏览器 | `L1` |
| `SCRIPT_ROOT` / `API_ROOT` / `CARD_FRAME_URL` / `apiUrl(path)` | 全部由 `document.currentScript.src` 派生；API 前缀 = 脚本目录 + `api/` | `L2` |
| `apiRequestId()` | 生图请求去重用的 `clientRequestId`（`randomUUID` 优先，否则 `wf-时间戳-随机`） | `L3` |
| `readApiJson(response,label)` | 统一响应解码；空响应/非 JSON/非 2xx 抛出带 `code`/`status`/`requestId` 的错误 | `L4` |
| `requestGeneratedAsset(payload)` / `recoverGeneratedAsset(id)` | 付费生图：单次 POST，传输层失败后按 ID 轮询找回，**不自动重试** | `L7` / `L6` |
| `CONTENT_KEYS` / `MIGRATION_KEY` / `BACKUP_KEY` | 需同步到 SQLite 的键集合；迁移标记与迁移前快照键 | `L8` |
| `LORE_TYPES` | 13 类资料元数据（label、ID 前缀、属性字段名）；资料类型与 ID 前缀的唯一真值 | `L9–L10` |
| `AI_CONTENT_BLOCKS` | 每种资料类型可被 AI 生成的内容块白名单（`name`/`summary`/`details`/`attributeA-C`/`constraints`/`openQuestions`） | `L11` |
| `W01_SEED` | 只读种子世界；`readLore()` 在缺少 `W01` 时自动注入，持久化时会被 `.filter(!seeded)` 排除 | `L13` |
| `readStore(k,f)` / `writeStore(k,v)` / `lines(v)` | JSON 读写；写正文键时触发 `scheduleContentSync()`；`lines` 把多行文本按行拆成数组 | `L18` |
| `contentSnapshot()` / `contentReady` / `contentRevision` | 同步载荷与乐观锁版本号；`contentReady=false` 表示同步已停用（初始加载失败或 409） | `L19` |
| `mergeById` / `mergeContent` / `cacheContent` / `hasContent` | 迁移用合并策略（服务端为底、本地覆盖）与缓存回写 | `L21–L23` |
| `scheduleContentSync()` / `persistContent()` | 160ms 去抖后 `PUT api/content`；并发时排队而非并行；409 时停同步并提示导出 | `L25` / `L26` |
| `hydrateContent()` | 启动时 GET `api/content`：未初始化→推送本地；已初始化且本地有内容且未迁移→备份、合并、再推送；否则以服务端覆盖本地缓存 | `L27` |
| `showToast(m)` / `setStorageStatus(text,state)` | 2s toast；页头 SQLite 状态徽标 | `L28` / `L24` |
| `readPreferences()` / `applyPreferences()` | 偏好读写并落到 `<html data-theme/data-density>` | `L29` / `L30` |
| `captureTypePrompt` / `showTypePrompt` / `captureImagePrompt` / `showImagePrompt` | 设置面板里“多分类提示词草稿”的切换，未保存前只存在内存 `promptProfileDrafts`/`imagePromptDrafts` | `L31–L34` |
| `openSettings()` / `saveSettingsWithVisuals(event)` | 设置：密钥永不回填（留空=不改），`clearApiKey`/`clearSeedreamApiKey` 显式清除。**`#settingsSave` 最终绑定到 `saveSettingsWithVisuals`**，Agent 选择（`agentPresets: agentSettingsPatchFromForm()`）与生图提示词都在这条路径上；`openSettingsWithVisuals` 先调用 `openSettings` 再补视觉提示词 | `L35` / `L219` |
| `switchModule(m)` | 模块路由唯一入口：切换 `[data-module]`/`[data-page]`、改 `document.title`，并调用 `WorldforgeBattleUI.refresh`、`WorldforgeMacro.refresh`、`refreshSimulation` | `L37` |
| `normalizeLore(e)` | 资料归一化：非法类型回落 `world`；`story` 强制 `status=proposed`/`truthScope=unknown` 并清空摘要与标签；`location`/`chronicle` 字段交由子脚本归一 | `L38` |
| `readLore` / `persistLore` / `makeLoreId` | 读含种子、写剔除种子；ID = `<前缀>-<36 进制时间戳>` | `L39` |
| `currentWorldId()` / `worldGroups()` | 当前世界取自 `activeWorldId` → 偏好 `worldId` → `W01`；分组委托 `WorldforgeWorldScope.groups` | `L41` / `L42` |
| `renderWorldHub` / `worldPanel` / `renderWorldDetailHeader` / `enterWorld` / `leaveWorld` | 世界列表与详情两层视图；未归属分组提供“归入某世界”下拉 | `L46` / `L45` / `L47` / `L48` / `L49` |
| `createWorld()` / `adoptWorldGroup(...)` | 新建下一可用 `W##`；把孤儿资料批量改 `worldId`（`WorldforgeWorldScope.reassign`） | `L50` / `L51` |
| `setTypeAttributes(t)` / `updateLoreBadge(s)` | 按资料类型改写表单标签/占位符/按钮文案并显示地图、编年史专属字段组 | `L52` |
| `selectLoreType` / `loadLore` / `collectLoreForm` / `saveLore` / `deleteLore` / `resetLoreEditor` / `fillLoreForm` / `loreListItem` / `renderLoreList` | 资料编辑器主链路：选中→填表→收集→落库→重渲染 | `L78`–`L83`, `L95`, `L103`, `L77` |
| `populateLocationParents` / `beginGeographyEntry` / `prepareGeographyFramework` / `geographyNode` / `renderGeographyTree` | 地理层级：父级下拉只列 `allowedParentKinds` 合法项；树渲染 + 搜索可见集 | `L53`, `L84`–`L87` |
| `populateChronicleParents` / `beginChronicleEntry` / `chronicleNode` / `renderChronicleTree` | 编年史容器/节点两态与其排序值展示 | `L54`, `L92`–`L94` |
| `pickerTargets`（`lore`/`card`/`free`）+ `openPicker` / `renderPicker` / `applyPicker` / `pickerFilters` / `renderPickerSummary(ies)` / `populateRelations` | 关系选择器复用一套对话框，靠 `pickerTargetKey` 区分三处调用点与各自的回填目标 | `L56–L60`, `L61`–`L74` |
| `renderAttachedStories` / `createAttachedStory` | 资料下挂的背景故事列表与新建 | `L75` / `L76` |
| `runAi` / `renderAiVariants` / `applyAiVariant` / `overwriteWithAiVariant` / `mergeAiContent` / `saveAiSelections` / `renderAiContentBlocks` / `selectedAiBlocks` / `updateAiSelection` / `renderAiDiagnostics` / `refreshAiStatus` | AI 设定助手：只产出 `proposed` 候选，勾选后由 `saveAiSelections` 写入资料库 | `L88`–`L106` |
| `normalizeCard` / `readCards` / `keywordMap` / `formatKeywordUsage` | 卡牌读取层；`normalizeCard` 直接转调 `WorldforgeCards.normalize` | `L107` |
| `currentCardCrop` / `applyCardCrop` / `clampCardCrop` / `bindCardArtGestures` / `renderCardFrame` / `renderCardArt` / `renderCardSubtype` | 卡面预览、原画裁剪（拖动/滚轮/滑杆）与种族-派系文案 | `L110`–`L118` |
| `compileCardPng` 及其绘制依赖 `loadCanvasImage` / `roundedPath` / `artRect` / `drawCoverCrop` / `canvasTextFont` / `richTextLines` / `drawCompiledDescription` / `drawCardStat` / `drawCardName` / `drawCardSubtype` | 卡面 PNG 编译器（660×920 canvas），与 DOM 预览共用 `compileDescription` 的 runs | `L119`–`L129` |
| `cardPngCache` | 以卡牌 ID 缓存 dataURL 或进行中的 Promise，避免重复编译 | `L15` / `L152` / `L159` |
| `renderArtCandidates` / `refreshArtAssets` / `artFileUrl` / `openImageViewer` / `unbindArtAsset` | 素材库、候选图墙、大图查看与解绑（解绑后仍留在“未使用原画”） | `L131` / `L132` / `L108` / `L109` / `L189` |
| `referencePool` / `referenceButton` / `renderReferenceAssets` / `fileDataUrl` / `uploadReferenceFiles` | 参考图（最多 10 张）选择与上传 | `L136`–`L140` |
| `renderLoreLinkedCards` / `bindExistingCardToLore` / `unbindCardFromLore` / `beginCardFromLore` | 资料↔卡牌双向绑定；“先有卡后补设定”路径 | `L141`–`L143`, `L150` |
| `defaultArtPrompt` / `optimizeCardArtPrompt` / `generateCardArt` / `clearCardArt` / `updateImageProviderStatus` / `refreshImageStatus` | 卡牌插画：提示词优化、按通道可用性启用生成按钮、清除绑定 | `L144`–`L146`, `L133`–`L134` |
| `renderCardKeywordPreview` / `renderKeywordPreview` / `renderKeywords` | 关键词选择与描述预览（run → `span.compiled-inline`） | `L147`–`L149` |
| `renderCards` / `miniCard` / `switchCardTab` / `resetCardEditor` / `loadCard` / `saveCurrentCard` / `renderArtworkGallery` / `artworkEntries` | 卡牌库分页/筛选、编辑器装载与保存、原画集 | `L152`, `L151`, `L156`–`L159`, `L155`, `L154` |
| `FREE_ATTACH_LIMIT` / `toggleFreeAttachment` / `renderFreeAttachments` / `freeContextSnapshot` / `freeContextPreview` / `freeAgentMeta` / `renderFreeChat` / `sendFreeMessage` / `runNameTool` | 自由创作 Agent：图片附件上限 4、参考资料授权范围、对话记录只存内存 | `L161`, `L163`–`L169` |
| `renderSimulation` / `refreshSimulation` / `simulationPreset` / `advanceSimulation` / `runFullSimulation` / `resetSimulation` / `disableSimulationControls` / `simulationResource` / `simulationLogRow` | W99 能源危机诊断（折叠面板），行动预设 → `simulation/advance` | `L170`–`L179` |
| `currentCardImagePayload` / `currentLoreImagePayload` / `defaultLoreArtPurpose` / `composeVisualPrompt` / `renderLoreArtCandidates` / `updateLoreVisualState` / `prepareLoreVisualPrompt` / `optimizeLoreVisualPrompt` / `generateLoreVisual` | 视觉原型链路（后置覆盖版，见约束）；载荷含 `targetType/targetId/purpose/provider/size/referenceAssetIds/library` | `L185`–`L194` |
| `optimizeCardArtPromptWithLore` / `generateCardArtWithLore` / `openSettingsWithVisuals` / `saveSettingsWithVisuals` | 带生图提示词设置的覆盖版本，在 `L225` 最终绑定；`saveSettingsWithVisuals` 同时提交文字提示词、视觉提示词与三个 Agent preset 选择 | `L219`–`L220` |
| `loadLore` / `resetLoreEditor` / `refreshArtAssets` 的**重绑定** | `L199` 先存原函数，`L200–L202` 覆盖为“原逻辑 + 视觉/AI 状态刷新” | `L199`–`L202` |
| `readUiState` / `aiPanelState` / `applyAiPanel` / `setAiPanel` | AI 面板 open/min/closed 三态存 `worldforge-ui-state-v1` | `L207`–`L210` |
| `refreshAgentCatalog` / `refreshAgentSettings` / `agentPresetFor` / `fillPresetSelect` / `syncFreePresetBar` / `agentPanelStatusText` / `applyAgentSettingsAfterSave` | 三个预设选择器与状态文案：目录来自 `api/ai/presets`，`agentCatalogFallback` 记住响应里的 `fallback` 标记；已保存但消失的 preset 显示「（已不可用）」而不改写选择 | `L198` / `L199` / `L195` / `L200` / `L201` / `L204` / `L206` |
| `agentSettingsPatchFromForm` / `agentSelectionIsValid` / `chooseFreePreset` | 只提交仍存在的 preset；切换自由对话 preset 需确认并清空当前对话 | `L203` / `L202` / `L207` |
| `bootstrap()` | 启动序列：`hydrateContent` → `refreshArtAssets` → `applyPreferences` → `leaveWorld` → `renderPickerSummaries` → `resetCardEditor` → 并行取 AI/图像状态 → `updateLoreVisualState` → `applyAiPanel`；加载时立即执行 | `L211` |

## 重点逻辑

- **数据同步与迁移（`L26`–`L27`）**：`persistContent` 用 `expectedRevision: contentRevision` 做乐观锁，成功后回写 `contentRevision` 并置 `MIGRATION_KEY`；`409` 时不再写库（`contentReady=false`），提示“先导出再刷新”，避免覆盖他端写入。`hydrateContent` 区分三种启动态（库未初始化/需迁移/已就绪），迁移前把本地快照存进 `BACKUP_KEY`。
- **付费生图失败恢复（`L6`–`L7`）**：只有空响应、非 JSON、读取失败或 `TypeError`（网络）才进入找回流程；HTTP 语义错误（如 4xx）直接抛出，不找回也不重试。
- **卡面一致性（`L129` + `L147`）**：预览与 PNG 都从 `WorldforgeCards.compileDescription()` 的 `runs` 出发，字体随字数降档（`L125`：>95 字 21px 起，最多 7 行），裁剪由 `artRect(type)` 按卡牌类型给出画框。
- **保存卡牌的宽松策略（`L159`）**：先 `compileCardPng` 写入 `cardPngCache` 再做本地落库；PNG 编译失败只 toast 警告，卡牌仍然保存（`compiled=false` 分支）。
- **AI 候选只读（`L101`–`L106`）**：`runAi` 把当前表单 + 勾选内容块 + 参考条目发给 `api/ai`，返回的变体留在 `aiVariants`；只有 `saveAiSelections` 会把所选合并成独立 `proposed` 条目，不会覆盖当前编辑中的资料。
- **回滚模式的界面提示（`L198`–`L204`）**：`api/ai/presets` 带 `fallback: 'legacy-fixed-prompts'` 时，`fillPresetSelect` 把选择器替换为单个 disabled 的「固定提示（回滚模式）」，`syncFreePresetBar` 与 `agentPanelStatusText` 改显回滚文案；这是「运维已切回固定 persona」，不是「配置丢失」，因此不得显示空的「没有兼容的 preset」。

## 重要约束

- 顶层读取 `document.currentScript.src`（`L2`），必须以普通 `<script>` 同步加载；改为 `type="module"` 会在启动即抛错。
- 正文写入必须经 `writeStore`（`L18`）走 `scheduleContentSync`，直接 `localStorage.setItem` 不会触发 SQLite 同步；例外是 `cacheContent`（`L23`），它只用于回写缓存。
- `L204` 注册的 handler 有相当一部分被 `L225` 覆盖（`#saveLore`、`#openSettings`、`#saveSettings`、生图/优化按钮）。**`#saveSettings` 的旧 `saveSettings` 已删除**：它曾含 Agent 选择却从未被绑定（Sprint 3 复审回归），现在 Agent 选择只在最终绑定的 `saveSettingsWithVisuals` 里。新增设置项时请只改被绑定的那一份，并用 `tests/agent-settings-ui.test.mjs` 的「解析最终绑定」断言验证。
- 生图/提示词优化按钮的可用性由 `llmReady` 与 `imageStatus[provider]` 双重控制（如 `L191`、`L193`）；未配置密钥时按钮保持 disabled，源码中不存在绕过路径。
- 卡面上的资料引用只做 ID 引用，不改写被关联条目（`relationIds` / `loreRefs` 均为去重数组）；删除条目时关联是否清理静态分析无法确认。
- 回滚标记必须来自服务端响应（`agentCatalogFallback` 只由 `api/ai/presets` 的 `fallback` 字段赋值），前端不得自行推断或持久化该状态；恢复预设时移除 `WORLDFORGE_AGENT_LEGACY_PROMPTS` 并重启服务端即可。
