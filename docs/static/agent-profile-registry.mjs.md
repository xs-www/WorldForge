# `agent-profile-registry.mjs`

> 作用：产品侧 Agent Profile Registry。启动时从固定根目录发现随仓库/镜像发布的 preset 投影，严格校验清单、安全解析 prompt 路径、计算确定性指纹，返回深度冻结的只读快照；任何缺陷都以冻结错误码 fail-fast，不跳过、不降级。永不读取或执行 `agent.cordis.yml`、`preset.yml`、`skills/` 与用户 `~/.dsh` preset。

## 关键符号

| 符号 | 作用 / 契约（含关键错误码） | 位置 |
| --- | --- | --- |
| `AGENT_RUNTIME_SCHEMA_PATH` / `AGENT_PRESETS_ROOT` | 部署副本 schema 与默认根目录，均相对本模块解析 | `L24` / `L27` |
| `AGENT_PRESETS_ROOT_ENV` | 覆盖根目录的环境变量 `WORLDFORGE_AGENT_PRESETS_DIR` | `L30` |
| `AgentProfileError(code, message, details)` | 统一错误；`message` 为 `code: message`，无 `status` 字段 | `L35` |
| `isSchemaType` / `equalJson` / `validateNode` | 最小 JSON Schema 求值核心，未支持关键字不在此处理 | `L48` / `L59` / `L69` |
| `FIELD_ERROR_CODES` / `classifyManifestError` | 字段 → 错误码映射；`required`/`type`/根路径归 `AGENT_MANIFEST_INVALID` | `L123` / `L137` |
| `pickErrorCode(errors)` | 合并优先级：`AGENT_COMPAT_MISMATCH` > `AGENT_PROMPT_PATH_UNSAFE` > `AGENT_ENUM_UNKNOWN` > `AGENT_MANIFEST_INVALID` | `L152` |
| `baseFieldSpecs(schema)` / `createSchemaValidator(schema)` | 剥掉字段上的 `allOf/if/then/contains`；产出 `evaluate` / `evaluateBase` / `unsupported` | `L161` / `L170` |
| `loadRuntimeSchema()` | 读并缓存 schema；不可读、非 JSON、含未支持关键字 → `AGENT_MANIFEST_INVALID` | `L202` |
| `deepFreeze(value)` / `stableStringify(value)` | 递归冻结；对象键排序的确定性序列化 | `L217` / `L226` |
| `profileFingerprint(manifest, systemPrompt)` | `{ manifestHash, systemPromptHash, hash }`；`hash` 用 `\u0000` 连接两段文本 | `L240` |
| `validateAgentRuntimeManifest(value, directoryId)` | 两遍校验 + 目录名一致性（`AGENT_ID_MISMATCH`） | `L255` |
| `assertSurfaceCompatibility(manifest)` | 逐 surface 比对兼容矩阵 → `AGENT_COMPAT_MISMATCH`；未登记 surface → `AGENT_ENUM_UNKNOWN` | `L275` |
| `isInsideRoot(target, root)` | 相对路径非空且不含 `..` 段、非绝对 | `L287` |
| `assertRealPathInside(target, presetReal, label)` | `realpath` 后仍在 preset 内，否则 `AGENT_PROMPT_PATH_UNSAFE`；解析失败 → `AGENT_PROMPT_MISSING` | `L297` |
| `resolveAgentPromptPath(presetDirectory, systemPrompt)` | 安全解析 prompt，返回 `{ path, relativePath, text }` | `L310` |
| `lstatOrNull(target)` | `ENOENT`/`ENOTDIR` 归一为 `null`，其余异常上抛 | `L349` |
| `publicAgentProfile(profile)` | 浏览器视图：不含 `toolPolicy`、prompt 正文与路径 | `L359` |
| `agentPresetsRoot(override)` | 显式参数 > 环境变量 > 模块内目录 | `L376` |
| `listPresetDirectories(root)` | 跳过 `.` 开头项；符号链接目录 → `AGENT_PROMPT_PATH_UNSAFE`；根不可读 → `AGENT_ROOT_UNREADABLE` | `L381` |
| `loadManifestFile(root, directory, directoryId)` | 三层 realpath 校验后读清单（8 192 字符上限、禁 NUL） | `L397` |
| `loadProfile(root, directoryId)` | 校验 → 兼容矩阵 → prompt → 保留标记 → 指纹 → 冻结 | `L425` |
| `loadAgentProfiles(rootOverride)` | 全量加载、重复 ID 与入口覆盖检查，返回冻结 registry | `L465` |
| registry `get / profilesForSurface / resolve` | `get` 未命中返回 `null`；`profilesForSurface` 未登记 surface → `AGENT_PROFILE_INCOMPATIBLE`；`resolve` 缺 id 或未找到 → `AGENT_PROFILE_UNKNOWN`，入口不被支持 → `AGENT_PROFILE_INCOMPATIBLE` | `L499`–`L513` |
| `publicRegistryView` / `registryHealthSummary` | `/api/ai/presets` 与 `/api/health` 的脱敏视图 | `L519` / `L528` |
| `asAgentProfileError(error)` | 非 `AgentProfileError` 包装为 `AGENT_MANIFEST_INVALID` | `L539` |

## 重点逻辑

### 两遍 Schema 校验（`validateAgentRuntimeManifest` `L255`）
- 第一遍 `evaluateBase`：只跑根 `properties` 的字段级关键字（`baseFieldSpecs` `L161` 就地剥掉 `allOf/if/then/contains`），错误按字段归码后由 `pickErrorCode` 取最高优先级，逐条 message 同时进入 `message` 与 `details`。
- 第二遍 `evaluate`：只保留被归类为 `AGENT_COMPAT_MISMATCH` 的错误（即 `const`/`contains` 条件分支），保证兼容性缺陷与结构缺陷不混在同一个 code。
- 最后比对 `manifest.id === directoryId`（`AGENT_ID_MISMATCH`）。函数原样返回入参对象：不做字段裁剪、复制或类型转换，额外字段由 Schema 的 `additionalProperties: false` 在第一遍拦截。
- 校验器是 `agent-runtime.schema.json` 的子集实现；schema 中出现未支持关键字时加载即失败（`L171`/`L211`），不静默忽略。

### 路径安全（`resolveAgentPromptPath` `L310`）
- 顺序检查：非空字符串 → 非绝对路径/盘符/`\` 开头（`AGENT_PROMPT_PATH_UNSAFE`）→ 按 `[\\/]+` 分段且不含 `..` → `resolve` 后 `isInsideRoot`。
- 逐段 `lstat`：不存在 → `AGENT_PROMPT_MISSING`；任一段（含中间目录）是符号链接 → `AGENT_PROMPT_PATH_UNSAFE`；随后 `realpath` 二次确认仍在 preset 内（`assertRealPathInside` `L297`）。
- 文件层：必须是普通文件（否则 `AGENT_PROMPT_MISSING`）、字节数 ≤ `AGENT_PROMPT_MAX_CHARS * 4`（`AGENT_PROMPT_TOO_LARGE`）、`TextDecoder('utf-8',{fatal:true})` 解码失败或含 NUL → `AGENT_PROMPT_MISSING`、字符数 ≤ `AGENT_PROMPT_MAX_CHARS`。
- 同一套 `isInsideRoot` + `realpath` 也用于 preset 目录与清单文件（`loadManifestFile` `L397`）：目录或清单本身是符号链接、或真实路径逃出根目录，都拒绝。

### 加载顺序（`loadAgentProfiles` `L465`）
1. `agentPresetsRoot` 解析根目录 → `listPresetDirectories` 读取并排序；根内无任何目录 → `AGENT_ROOT_UNREADABLE`。
2. 逐目录 `loadProfile`：`loadManifestFile` → `validateAgentRuntimeManifest` → `assertSurfaceCompatibility` → `resolveAgentPromptPath` → 保留标记扫描（命中 `AGENT_PROMPT_RESERVED_TAGS` 即 `AGENT_MANIFEST_INVALID`，`L430`）→ `profileFingerprint` → `deepFreeze`。
3. 循环中检测重复 `id`（`AGENT_ID_MISMATCH`），加载完成后按 `id.localeCompare` 排序。
4. 按契约里的 `AGENT_SURFACES`（而非已加载 profile 的 key）计算 `defaults`：每个 surface 取首个声明它的 profile，缺失即 `AGENT_PROFILE_UNKNOWN`；因此删掉某个默认 preset 会让服务拒绝启动，而不是把入口降级为 `null`。
5. 返回冻结 registry：`schemaVersion`、`profiles`、`summary{ count, countBySurface, diagnostics, root }`、`defaults` 与查询方法。`diagnostics` 在成功路径恒为空数组（失败即抛，不返回部分结果）。

### 冻结快照与投影
- profile 内 `manifest` 先 `structuredClone` 再冻结，`surfaces` 用副本；`countBySurface`、`defaults`、`summary`、`profiles` 与 registry 本身也都 `Object.freeze`，调用方无法通过嵌套引用改写快照。
- `publicAgentProfile` 只输出 `id/version/displayName/description/surfaces/mode/outputContract/statusPolicy/hash`；`toolPolicy`、`systemPrompt`、`systemPromptPath` 只留在服务端 registry 内。

## 错误码来源（fail-fast 语义）

| 错误码 | 触发位置 |
| --- | --- |
| `AGENT_ROOT_UNREADABLE` | 根目录 `readdir` 失败 `L384`、根 `realpath` 失败 `L400`、根内无 preset `L468` |
| `AGENT_MANIFEST_UNREADABLE` | 缺少清单 `L407`、清单 `realpath` 失败 `L411`、读取失败 `L416`、JSON 解析失败 `L421` |
| `AGENT_MANIFEST_INVALID` | 字段结构缺陷（`pickErrorCode` 兜底）、非对象清单 `L257`、schema 不可读/非 JSON/含未支持关键字 `L206`/`L209`/`L211`、清单 >8192 字符或含 NUL `L417`/`L418`、prompt 含保留标记 `L431`、`asAgentProfileError` 兜底 `L541` |
| `AGENT_ENUM_UNKNOWN` | 枚举字段（`surfaces`/`mode`/`toolPolicy`/`outputContract`/`statusPolicy`）值越界、未登记 surface `L278`/`L502` |
| `AGENT_ID_MISMATCH` | `manifest.id` 与目录名不一致 `L266`、重复 id `L475` |
| `AGENT_COMPAT_MISMATCH` | Schema 条件分支 `const`/`contains` 命中 `L147`/`L264`、兼容矩阵不匹配 `L281` |
| `AGENT_PROMPT_MISSING` | prompt `realpath` 失败 `L300`、路径不存在 `L330`、非普通文件 `L336`、非 UTF-8 `L342`、含 NUL `L343` |
| `AGENT_PROMPT_PATH_UNSAFE` | 空/绝对/穿越/逃逸 `L311`–`L323`、路径任一段是符号链接 `L331`、preset 目录或清单是符号链接或逃出根目录 `L390`/`L402`/`L403`/`L408`/`L412`、Schema `not` 命中 `L144` |
| `AGENT_PROMPT_TOO_LARGE` | 字节 > 4×上限 `L337`、字符 > 上限 `L344` |
| `AGENT_PROFILE_UNKNOWN` | 某 surface 无可用 preset `L489`、`resolve` 缺少 id `L506` 或未找到 `L508` |
| `AGENT_PROFILE_INCOMPATIBLE` | 查询未登记 surface `L502`、preset 不服务该入口 `L510` |

- 抛异常即代表整个 Registry 不可用：没有「跳过坏 preset」或「换默认 persona」的分支，`summary.diagnostics` 只会在成功路径出现且为空。
- `AgentProfileError` 不带 HTTP 状态；`server.mjs` 的 `resolveSurfaceProfile` 把它统一改写为 400，使不兼容 preset 在模型调用前失败且不产生外部费用。

## 重要约束
- 只有根目录下不以 `.` 开头、且不是符号链接的目录名会被当作 preset；`.` 开头项与普通文件静默跳过，符号链接目录直接报错而非忽略。
- 指纹基于规范化 manifest 与 prompt 文本，同内容必得同哈希；`server.mjs` 在启动期一次性加载，请求期间不再读取本模块的磁盘状态。
- `AGENT_PRESETS_ROOT_ENV` 是唯一可改变根目录的运行时入口，供测试与运维指向只读快照目录。
