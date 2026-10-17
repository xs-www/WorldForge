# `dist/styles.css`

> 作用：全站单文件样式（228 行、约 90 KB，绝大多数压缩成超长行）。无 `@import`、无 `@layer`，完全靠书写顺序与选择器权重分层。

- **令牌层**：`L1` 的 `:root` 定义颜色/间距/圆角等自定义属性；`L2` 的 `[data-theme="dark"]` 只覆盖同名变量，故新增颜色必须先在 `:root` 定义再在暗色块补值。
- **基础层**：`L3` 是 reset + `body` + 通用组件（按钮、面板、徽标、卡面底座）的混合长行；页面级排版从这里继承。
- **模块层**：每个模块自带一段布局与自己的断点，按 world（`L8`–`L23`）→ cards（`L8`–`L11`）→ free（`L34`–`L39`）→ simulation（`L44`–`L45`）→ macro（`L49`–`L52`）→ 全局头部（`L53`）的顺序堆叠，后写者覆盖先写者。
- **定位策略**：桌面端主要工作区都是多列 grid（`.world-grid`、`.lore-workspace`、`.card-workspace`、`.free-workspace`、`.macro-layout`）；侧栏在窄屏降级为 `position:static` 并跨整行；AI 助手是 `position:fixed` 右侧抽屉（`L177`），收起后由竖排按钮 `.ai-reopen`（`L187`）重新打开，≤820px 变为底部抽屉（`L192`）。
- **地图定位**：`.macro-region` 不写死坐标，靠 `--q`/`--r`/`--offset` 自定义属性与 `calc()` 百分比定位（`L50`、`L52` 各有 700px 断点版本）。
- **主题/密度**：暗色通过 `[data-theme]` 前缀选择器追加覆盖（如 `L153`、`L172`），密度由 `[data-density]` 控制，二者都由 `app.js` 的 `applyPreferences` 写在 `<html>` 上。
- **账号面板是上下两段**：`.user-row` 用 `flex-direction:column`（信息在上、7 个操作控件在下并 `flex-wrap`）。0.3.0 曾用 `grid` + `minmax(0,1fr) auto`，操作区 max-content 超过可视宽度时把信息列压成 0 宽，中文会被 `word-break` 逐字换行成竖排；只有真正存在账号行时才暴露（匿名模式列表为空）。
- **重复声明**：`.lore-workspace` 的 1200px/820px 断点在 `L22`、`L23` 与 `L175`、`L176` 各出现一次，实际生效的是后两行；调整该布局时需同时检查四处，否则改动可能被后续规则覆盖。
- **设定导入对话框**：`L262` 起的 `.lore-import-*` / `.import-*` 段是独立追加的一段（不压缩成单行），包含对话框宽度、原文文本域、文件读取行、逐条勾选列表与告警块；`.import-review[hidden]` 必须显式写 `display:none`，因为 `.import-review{display:grid}` 会覆盖浏览器对 `[hidden]` 的默认样式。
