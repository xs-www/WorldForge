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
| `LORE_GROUPS_KEY` / `LoreGroups` / `readCustomLoreGroups` / `derivedLoreGroups` / `loreGroupsView` / `loreGroup(type)` / `loreTypesWithForm(form)` / `loreGroupKey(group)` / `commitLoreGroups(scoped)` | 资料组层：六项固定组（世界/世界地图/角色/编年史/背景故事/设定）由 `WorldforgeLoreGroups` 提供，其余是作者自定义组，带 `worldId` 作用范围；派生只按当前世界的资料。**不再有静态类型表，也没有默认世界种子** | `L11`–`L29` |
| `legacyValues` / `entryValues` / `valuesFromFields` / `renderLoreFields(group,values)` / `readLoreFieldsRaw()` | 内容块：条目把值存在 `values` 里；编辑器表单由组字段动态生成（单行/多行/每行一项/数值），因此可以没有摘要、约束或开放问题 | `L31`–`L72` |
| `reconcileGroupFields(group)` | 固定组没有保存过字段覆盖时，把该世界资料里实际用到的旧字段补回视图 | `L18` |
| `aiBlocksForGroup(group)` | 由资料组的 `form` + 三个属性名生成 AI 可生成内容块；表单字段与 AI 白名单因此永远同源 | `L23` |
| `activeGroupIdWithForm(form)` / `renderLoreTabs()` | 按 `form` 找当前组（供地理/编年史新建入口）与动态渲染标签页 | `L24` / `L26` |
| `readStore(k,f)` / `writeStore(k,v)` / `lines(v)` | JSON 读写；写正文键时触发 `scheduleContentSync()`；`lines` 把多行文本按行拆成数组 | `L18` |
| `contentSnapshot()` / `contentReady` / `contentRevision` | 同步载荷与乐观锁版本号；`contentReady=false` 表示同步已停用（初始加载失败或 409） | `L19` |
| `mergeById` / `mergeContent` / `cacheContent` / `hasContent` | 迁移用合并策略（服务端为底、本地覆盖）与缓存回写 | `L21–L23` |
| `scheduleContentSync()` / `persistContent()` | 160ms 去抖后 `PUT api/content`；并发时排队而非并行；409 时停同步并提示导出 | `L25` / `L26` |
| `hydrateContent()` | 启动时 GET `api/content`：未初始化→推送本地；已初始化且本地有内容且未迁移→备份、合并、再推送；否则以服务端覆盖本地缓存 | `L27` |
| `showToast(m)` / `setStorageStatus(text,state)` | 2s toast；页头 SQLite 状态徽标 | `L28` / `L24` |
| `refreshVersionBadge()` | 读 `api/health` 的 `version` 填 `#appVersion`，并与 `<meta name="worldforge-version">` 比对：不一致时加 `stale` 类并提示「页面已过期，请刷新」；`title` 附带页面版本、harness 版本、persona 来源与是否降级 | `L257` |
| `readPreferences()` / `applyPreferences()` | 偏好读写并落到 `<html data-theme/data-density>` | `L29` / `L30` |
| `captureTypePrompt` / `showTypePrompt` / `captureImagePrompt` / `showImagePrompt` | 设置面板里“多分类提示词草稿”的切换，未保存前只存在内存 `promptProfileDrafts`/`imagePromptDrafts` | `L31–L34` |
| `openSettings()` / `saveSettingsWithVisuals(event)` | 设置：密钥永不回填（留空=不改），`clearApiKey`/`clearSeedreamApiKey` 显式清除。**`#settingsSave` 最终绑定到 `saveSettingsWithVisuals`**，Agent 选择（`agentPresets: agentSettingsPatchFromForm()`）与生图提示词都在这条路径上；`openSettingsWithVisuals` 先调用 `openSettings` 再补视觉提示词 | `L35` / `L218` |
| `switchModule(m)` | 模块路由唯一入口：切换 `[data-module]`/`[data-page]`、改 `document.title`，并调用 `WorldforgeBattleUI.refresh`、`WorldforgeMacro.refresh`、`refreshSimulation` | `L37` |
| `normalizeLore(e)` | 资料归一化：`type` 接受任意组 id（空值时回落 `info`），行为由所属组的 `form` 决定——`story` 强制 `status=proposed`/`truthScope=unknown` 并清空摘要与标签，`chronicle` 才归一编年史字段；`worldId` 缺省为空串 | `L63` |
| `readLore` / `persistLore` / `makeLoreId(type,suffix)` | 读取时过滤 `seeded`（早期默认世界残留会被自动清掉）与无 `type` 的条目；稳定 ID = `<组 id 大写>-<世界或 W>-<36 进制时间戳>[-序号]` | `L64` |
| `currentWorldId()` / `worldGroups()` | 当前世界取自 `activeWorldId` → 偏好 `worldId` → **空串（未归属）**，没有默认世界；分组委托 `WorldforgeWorldScope.groups` | `L66` / `L67` |
| `renderWorldHub` / `worldPanel` / `renderWorldDetailHeader` / `enterWorld` / `leaveWorld` | 世界列表与详情两层视图；未归属分组提供“归入某世界”下拉 | `L46` / `L45` / `L47` / `L48` / `L49` |
| `createWorld()` / `adoptWorldGroup(...)` | 新建下一可用 `W##`；把孤儿资料批量改 `worldId`（`WorldforgeWorldScope.reassign`） | `L50` / `L51` |
| `LORE_IMPORT_LABELS` / `openLoreImport` / `readLoreImportFiles` / `renderLoreImportPlan` / `parseLoreImport` / `saveLoreImport` | 设定导入（ADR-0033）：`openLoreImport(worldId)` 两种入口共用同一对话框，`worldId` 非空即「并入当前世界」（解析带 `intoWorld`、保存带 `mode:"existing"`，隐藏世界名输入）；文件读取（`lore-import/extract`）→ 逐条勾选预览（含重复条目提示与「规范化 N 段」）→ `lore-import/commit`；勾选状态只在内存，保存后用服务端快照重载 | `L131`–`L143` |
| `renderLoreGroupSelect` / `renderBulkGroupSelect` / `updateLoreBulkBar` / `applyLoreBulkMove` / `lorePickSelection` / `loreListItem` | 条目分组调整：编辑器下拉（`#loreGroupSelect`）决定保存到哪个组/类型；资料列表每行带勾选框（`.lore-pick`），底部批量条（`#loreBulkBar`）可一次把选中条目移动到目标组，跨类型时重新生成条目 id 并重渲染 | `L145`–`L166`, `L210` |
| `setTypeAttributes(t)` / `updateLoreBadge(s)` | 按资料类型改写表单标签/占位符/按钮文案并显示地图、编年史专属字段组 | `L52` |
| `selectLoreType` / `loadLore` / `collectLoreForm` / `saveLore` / `deleteLore` / `resetLoreEditor` / `fillLoreForm` / `loreListItem` / `renderLoreList` | 资料编辑器主链路：选中→填表→收集→落库→重渲染。`collectLoreForm` 里世界条目的 `worldId` 恒等于其自身 `id`；在某个世界内新建「世界」条目会被拒绝，要求回世界列表 | `L103`–`L108`, `L111`, `L114` |
| `populateLocationParents` / `beginGeographyEntry` / `prepareGeographyFramework` / `geographyNode` / `renderGeographyTree` | 地理层级：以 `form:'geography'` 的资料组集合为作用域（不再写死 `location`），父级下拉只列 `allowedParentKinds` 合法项 | `L88`, `L109`–`L112` |
| `populateChronicleParents` / `beginChronicleEntry` / `chronicleNode` / `renderChronicleTree` | 编年史容器/节点两态与其排序值展示；作用域是 `form:'chronicle'` 的资料组集合 | `L89`, `L117`–`L119` |
| `pickerTargets`（`lore`/`card`/`free`）+ `openPicker` / `renderPicker` / `applyPicker` / `pickerFilters` / `renderPickerSummary(ies)` / `populateRelations` | 关系选择器复用一套对话框，靠 `pickerTargetKey` 区分三处调用点与各自的回填目标 | `L56–L60`, `L61`–`L74` |
| `renderAttachedStories` / `createAttachedStory` | 资料下挂的背景故事列表与新建 | `L75` / `L76` |
| `runAi` / `renderAiVariants` / `applyAiVariant` / `overwriteWithAiVariant` / `mergeAiContent` / `saveAiSelections` / `renderAiContentBlocks` / `selectedAiBlocks` / `updateAiSelection` / `renderAiDiagnostics` / `refreshAiStatus` | AI 设定助手：只产出 `proposed` 候选，勾选后由 `saveAiSelections` 写入资料库；内容块来自 `aiBlocksForGroup(loreGroup(effectiveAiType()))`，请求里带资料组描述供服务端重标属性名 | `L115`–`L133` |
| `normalizeCard` / `readCards` / `keywordMap` / `formatKeywordUsage` | 卡牌读取层；`normalizeCard` 直接转调 `WorldforgeCards.normalize` | `L107` |
| `currentCardCrop` / `applyCardCrop` / `clampCardCrop` / `bindCardArtGestures` / `renderCardFrame` / `renderCardArt` / `renderCardSubtype` | 卡面预览、原画裁剪（拖动/滚轮/滑杆）与种族-派系文案 | `L110`–`L118` |
| `compileCardPng` 及其绘制依赖 `loadCanvasImage` / `roundedPath` / `artRect` / `drawCoverCrop` / `canvasTextFont` / `richTextLines` / `drawCompiledDescription` / `drawCardStat` / `drawCardName` / `drawCardSubtype` | 卡面 PNG 编译器（660×920 canvas），与 DOM 预览共用 `compileDescription` 的 runs | `L119`–`L129` |
| `cardPngCache` | 以卡牌 ID 缓存 dataURL 或进行中的 Promise，避免重复编译 | `L15` / `L151` / `L158` |
| `renderArtCandidates` / `refreshArtAssets` / `artFileUrl` / `openImageViewer` / `unbindArtAsset` | 素材库、候选图墙、大图查看与解绑（解绑后仍留在“未使用原画”） | `L131` / `L132` / `L108` / `L109` / `L188` |
| `referencePool` / `referenceButton` / `renderReferenceAssets` / `fileDataUrl` / `uploadReferenceFiles` | 参考图（最多 10 张）选择与上传 | `L135`–`L139` |
| `renderLoreLinkedCards` / `bindExistingCardToLore` / `unbindCardFromLore` / `beginCardFromLore` | 资料↔卡牌双向绑定；“先有卡后补设定”路径 | `L140`–`L142`, `L149` |
| `defaultArtPrompt` / `optimizeCardArtPrompt` / `generateCardArt` / `clearCardArt` / `updateImageProviderStatus` / `refreshImageStatus` | 卡牌插画：提示词优化、按通道可用性启用生成按钮、清除绑定 | `L143`–`L145`, `L132`–`L133` |
| `renderCardKeywordPreview` / `renderKeywordPreview` / `renderKeywords` | 关键词选择与描述预览（run → `span.compiled-inline`） | `L146`–`L148` |
| `renderCards` / `miniCard` / `switchCardTab` / `resetCardEditor` / `loadCard` / `saveCurrentCard` / `renderArtworkGallery` / `artworkEntries` | 卡牌库分页/筛选（含世界筛选）、编辑器装载与保存（保存前必须选世界）、原画集（原画按绑定目标继承世界） | `L151`, `L150`, `L155`–`L158`, `L154`, `L153` |
| `loreWorlds` / `worldNameOf` / `worldKey` / `fillWorldSelect` / `syncWorldSelects` / `selectCardWorld` / `updateCardWorldHint` | 世界下拉的唯一来源：编辑器、卡牌库、原画集三处共用；`syncWorldSelects` 只在世界列表变化时重建并保留当前选择，`updateCardWorldHint` 只提示跨世界引用而不阻止保存（ADR-0034） | `L306`–`L314` |
| `runCardAgent` / `cardAgentPayload` / `collectCardDraftForAgent` / `renderCardAgentResults` / `applyCardAgentVariant` / `saveCardAgentDraft` | 卡牌 Agent 面板：提交勾选字段与卡牌入口 preset 到 `api/ai/card`；候选只显示补丁字段（`review` 字段已按作者裁定移除，评审由作者完成），`fallbackReason` 以一条 chip 显示（接口不支持 `json_schema` 时的降级）；「应用到表单」只回填不保存，「保存为独立草案」新建 `proposed / untested` 卡 | `L124` / `L118` / `L123` / `L125` / `L134` / `L139` |
| `FREE_ATTACH_LIMIT` / `toggleFreeAttachment` / `renderFreeAttachments` / `freeContextSnapshot` / `freeContextPreview` / `freeAgentMeta` / `renderFreeChat` / `sendFreeMessage` / `runNameTool` | 自由创作 Agent：图片附件上限 4、参考资料授权范围、对话记录只存内存 | `L160`, `L162`–`L168` |
| `renderSimulation` / `refreshSimulation` / `simulationPreset` / `advanceSimulation` / `runFullSimulation` / `resetSimulation` / `disableSimulationControls` / `simulationResource` / `simulationLogRow` | W99 能源危机诊断（折叠面板），行动预设 → `simulation/advance` | `L169`–`L178` |
| `currentCardImagePayload` / `currentLoreImagePayload` / `defaultLoreArtPurpose` / `composeVisualPrompt` / `renderLoreArtCandidates` / `updateLoreVisualState` / `prepareLoreVisualPrompt` / `optimizeLoreVisualPrompt` / `generateLoreVisual` | 视觉原型链路（后置覆盖版，见约束）；载荷含 `targetType/targetId/purpose/provider/size/referenceAssetIds/library` | `L184`–`L193` |
| `optimizeCardArtPromptWithLore` / `generateCardArtWithLore` / `openSettingsWithVisuals` / `saveSettingsWithVisuals` | 带生图提示词设置的覆盖版本，在 `L224` 最终绑定；`saveSettingsWithVisuals` 同时提交文字提示词、视觉提示词与三个 Agent preset 选择 | `L218`–`L219` |
| `loadLore` / `resetLoreEditor` / `refreshArtAssets` 的**重绑定** | `L198` 先存原函数，`L200–L202` 覆盖为“原逻辑 + 视觉/AI 状态刷新” | `L198`–`L201` |
| `readUiState` / `aiPanelState` / `applyAiPanel` / `setAiPanel` | AI 面板 open/min/closed 三态存 `worldforge-ui-state-v1` | `L206`–`L209` |
| `refreshAgentCatalog` / `refreshAgentSettings` / `agentPresetFor` / `fillPresetSelect` / `syncFreePresetBar` / `agentPanelStatusText` / `applyAgentSettingsAfterSave` | 三个预设选择器与状态文案：目录来自 `api/ai/presets`，`agentCatalogFallback` 记住响应里的 `fallback` 标记；已保存但消失的 preset 显示「（已不可用）」而不改写选择 | `L197` / `L198` / `L194` / `L199` / `L200` / `L203` / `L205` |
| `agentSettingsPatchFromForm` / `agentSelectionIsValid` / `chooseFreePreset` | 只提交仍存在的 preset；切换自由对话 preset 需确认并清空当前对话 | `L202` / `L201` / `L206` |
| `renderLoreGroupPicker` | 资料组列表：一行一个组（预置组/自定义组 · 作用范围 · 字段数），点一下进入编辑；替代原来难懂的「要编辑的组」下拉 | `L363` |
| `openLoreGroupDialog` / `fillLoreGroupDialog` / `saveLoreGroupFromDialog` / `deleteLoreGroupFromDialog` / `refreshLoreGroupSelect` / `updateGroupScopeHint` | 资料组管理：新建（`WorldforgeLoreGroups.createGroup` 生成稳定 id）、改名/改 form/改作用范围/改属性名、删除空组；作用范围在世界内默认「仅当前世界」且可改选共享（预置组固定为共享、只读），共享组也能在这里创建 | `L308`–`L311` |
| `exportServerData(includeImages)` / `readImportFile` / `previewImport` / `applyImport` / `describeImportResult` | 数据搬运：导出走 `/api/export`（可选 `?images=1`），导入先 `dryRun` 预检再 `POST /api/import`（`X-Worldforge-Import: 1`），成功后重新 hydrate 并重渲染资料组与资料列表 | `L301`–`L306` |
| `bootstrap()` | 启动序列：`hydrateContent` → `refreshArtAssets` → `applyPreferences` → `renderLoreTabs` → `leaveWorld` → `renderPickerSummaries` → `resetCardEditor` → 并行取 AI/图像状态 → `updateLoreVisualState` → `applyAiPanel`；加载时立即执行 | `L312` |

## 重点逻辑

- **资料组与多世界（v0.3.1）**：标签页、表单形态、AI 内容块与地理/编年史作用域全部由「资料组」驱动；固定组有世界/世界信息/角色/编年史/背景故事/设定六项，其中「设定」（`misc`）是所有未指定分组的条目的落点，可逐条或批量改到自定义组。整库快照只提交**已保存**的组（`contentSnapshot` 用 `readCustomLoreGroups()`），派生组在各端按世界重算；`commitLoreGroups` 保存当前世界视图时保留其他世界的组。`readLore()` 会滤掉早期 `seeded` 的默认世界，`normalizeLore` 不再把缺失的 `worldId` 改写为 `W01`。
- **组作用范围默认本世界（`L472`–`L478`）**：资料组对话框的「作用范围」下拉世界内默认 `__world__`（仅当前世界），只有编辑**共享**组或固定组时才显示只读的共享值；`saveLoreGroupFromDialog` 直接取下拉的值写 `worldId`，不再用「值不存在即共享」这类隐式推断，避免把新组误存成全局共享。
- **导入不写 canon、不覆盖**：`saveLoreImport` 只提交服务端返回的计划快照；重复条目由服务端跳过，前端只显示告警，不做本地合并。
- **卡牌与原画按世界归属（v0.3.2，ADR-0034）**：`#cardWorldId` 是必选下拉（`fillWorldSelect` 由 `loreWorlds()` 生成，世界变化时 `syncWorldSelects` 重建并保留选择）；没有世界时 `saveCurrentCard` 直接 toast 拦截，旧数据缺世界的卡牌在编辑器里显示「未归属」等待补选。卡牌库 `#cardLibraryWorld` 与卡牌徽标 `.card-world-chip`、原画集 `#artworkWorld` 与 `.artwork-world` 徽标共用同一套世界列表；原画的世界取自服务端回填的 `asset.worldId`，缺失时回退到绑定卡牌/条目的 `worldId`，`data-world` 同时写在这两个容器上供断言。跨世界引用设定只由 `#cardWorldHint` 提示，不阻止保存。
- **数据同步与迁移（`L26`–`L27`）**：`persistContent` 用 `expectedRevision: contentRevision` 做乐观锁，成功后回写 `contentRevision` 并置 `MIGRATION_KEY`；`409` 时不再写库（`contentReady=false`），提示“先导出再刷新”，避免覆盖他端写入。`hydrateContent` 区分三种启动态（库未初始化/需迁移/已就绪），迁移前把本地快照存进 `BACKUP_KEY`。
- **付费生图失败恢复（`L6`–`L7`）**：只有空响应、非 JSON、读取失败或 `TypeError`（网络）才进入找回流程；HTTP 语义错误（如 4xx）直接抛出，不找回也不重试。
- **卡面一致性（`L129` + `L146`）**：预览与 PNG 都从 `WorldforgeCards.compileDescription()` 的 `runs` 出发，字体随字数降档（`L125`：>95 字 21px 起，最多 7 行），裁剪由 `artRect(type)` 按卡牌类型给出画框。
- **保存卡牌的宽松策略（`L158`）**：先 `compileCardPng` 写入 `cardPngCache` 再做本地落库；PNG 编译失败只 toast 警告，卡牌仍然保存（`compiled=false` 分支）。
- **AI 候选只读（`L101`–`L106`）**：`runAi` 把当前表单 + 勾选内容块 + 参考条目发给 `api/ai`，返回的变体留在 `aiVariants`；只有 `saveAiSelections` 会把所选合并成独立 `proposed` 条目，不会覆盖当前编辑中的资料。
- **回滚模式的界面提示（`L197`–`L203`）**：`api/ai/presets` 带 `fallback: 'legacy-fixed-prompts'` 时，`fillPresetSelect` 把选择器替换为单个 disabled 的「固定提示（回滚模式）」，`syncFreePresetBar` 与 `agentPanelStatusText` 改显回滚文案；这是「运维已切回固定 persona」，不是「配置丢失」，因此不得显示空的「没有兼容的 preset」。

## 重要约束

- 顶层读取 `document.currentScript.src`（`L2`），必须以普通 `<script>` 同步加载；改为 `type="module"` 会在启动即抛错。
- 正文写入必须经 `writeStore`（`L18`）走 `scheduleContentSync`，直接 `localStorage.setItem` 不会触发 SQLite 同步；例外是 `cacheContent`（`L23`），它只用于回写缓存。
- `L203` 注册的 handler 有相当一部分被 `L224` 覆盖（`#saveLore`、`#openSettings`、`#saveSettings`、生图/优化按钮）。**`#saveSettings` 的旧 `saveSettings` 已删除**：它曾含 Agent 选择却从未被绑定（Sprint 3 复审回归），现在 Agent 选择只在最终绑定的 `saveSettingsWithVisuals` 里。新增设置项时请只改被绑定的那一份，并用 `tests/agent-settings-ui.test.mjs` 的「解析最终绑定」断言验证。
- 生图/提示词优化按钮的可用性由 `llmReady` 与 `imageStatus[provider]` 双重控制（如 `L190`、`L192`）；未配置密钥时按钮保持 disabled，源码中不存在绕过路径。
- 卡面上的资料引用只做 ID 引用，不改写被关联条目（`relationIds` / `loreRefs` 均为去重数组）；删除条目时关联是否清理静态分析无法确认。
- 回滚标记必须来自服务端响应（`agentCatalogFallback` 只由 `api/ai/presets` 的 `fallback` 字段赋值），前端不得自行推断或持久化该状态；恢复预设时移除 `WORLDFORGE_AGENT_LEGACY_PROMPTS` 并重启服务端即可。
