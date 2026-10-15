# ADR-0012：发布 Action/Effect 契约并限制机制状态访问

- 状态：canon（技术边界）
- 日期：2026-10-15
- 决策者：作者
- 来源：作者批准继续推进 WorldForge 2.0

## 背景

M1 已验证确定性 Tick、三种能源 Action、统一 `resource.transfer` Effect、状态版本、知识隔离、快照与重放，但 Action/Effect 的结构仍由机制内手写校验隐式决定。机制注册表目前只声明命名空间和参数 Schema，没有声明具体 Action/Effect 类型、状态读写范围或知识发布权限。

这使 World Package 无法独立说明运行时输入输出契约，也无法在机制执行前后检查“只读声明范围”和“只产生已授权效果”。进入 M2、接入外部 Action API 或 LLM 提案前，需要先建立机器可读、默认拒绝的最小边界。

本提案只固化技术契约，不改变 W01 canon，不增加新模拟资源，也不授予 LLM 或外部调用者直接写状态的能力。

## 候选方案与代价

### A. 继续只在机制代码中手写校验

- 优点：改动最少，不增加 Schema 版本管理。
- 代价：World Package 不能自描述；权限只能靠代码审查；外部 Action 和机制扩展容易产生不一致校验。

### B. 引入 Action/Effect Schema 与机制级粗粒度读写集（建议）

- 优点：可发布、可测试、可在运行时统一校验；保持 M1 状态模型不变；不引入表达式语言或第三方 Schema 运行时。
- 代价：首版只能表达有限路径模式；每个新 Effect 类型都要先加入核心白名单和 Schema。

### C. 立即实现字段级能力令牌与通用策略语言

- 优点：能表达复杂组织授权、跨机制委托和动态条件。
- 代价：远超当前单城市、单资源纵切需求；策略语言本身会成为新的安全与确定性风险。

## 决策

选择方案 B，并采用以下最小契约。

1. 新增 Draft 2020-12 JSON Schema：
   - `simulation/schemas/action.schema.json` 定义通用 Action 信封：`actionId`、`actorId`、`type`、`expectedTick`、`parameters`。
   - `simulation/schemas/effect.schema.json` 定义核心允许的 Effect 联合类型；首版只有 `resource.transfer`。
   - 机制注册表为每个具体 Action 类型声明参数 Schema，不允许仅用命名空间接收任意结构。
2. Action 类型仍属于机制的 `actionNamespace`；Effect 类型必须属于注册表声明的 `effectNamespace`，并同时通过核心 Effect 白名单。机制不能通过注册命名空间绕过核心 Resolver。
3. 每个机制声明静态访问清单：
   - `reads`：机制 Validator/Resolver 可读取的状态路径模式；
   - `writes`：机制可通过 Effect 候选请求修改的状态路径模式；
   - `knowledge`：允许的知识分类与最大 TTL。
4. 首版路径不是任意 JSONPath，只接受受控语法：
   - `actor`、`knowledge`、`tick`；
   - `regions.*.state.resources.<resourceId>.<field>`；
   - `entities.*.state.resources.<resourceId>`。
   路径中的资源 ID 必须来自机制已验证参数，不能使用递归、过滤表达式或脚本。
5. 权限策略默认拒绝：未声明读取、未声明写入、未知 Action/Effect 类型、超出允许知识分类或 TTL 的结果均拒绝执行，并返回稳定错误码。
6. 验证顺序固定为：Action 信封 → 具体 Action 参数 → Actor/Tick 与业务 Validator → Effect Schema → Effect 写集 → 核心 Resolver → 知识策略。任何失败都不得部分提交状态。
7. M1 三种能源 Action 的行为、拒绝信息、确定性排序和资源守恒语义保持不变。现有 `MEC-001@1.0.0` 若契约内容变化则发布为 `1.1.0`，不得静默改写已发布版本。
8. World Package 继续嵌入编译后的机制契约，使 `packageHash` 覆盖 Action/Effect Schema 与权限声明；旧 `formatVersion: 1` 包保持可读，但缺少新契约时不得进入启用外部 Action/LLM 提案的运行模式。
9. 首版使用仓库现有的受限 Schema 校验能力，不增加第三方依赖。只支持实际使用到的对象、字符串、整数、枚举、常量和联合类型；扩大 Schema 子集需另行测试和记录。

## 验收条件

- 三种 M1 Action 均可从 World Package 中发现各自的参数 Schema。
- 多余参数、缺少参数、错误类型、未知 Action 和未知 Effect 在机制业务逻辑或状态写入前被拒绝。
- `resource.transfer` 只有在命中机制声明写集并通过核心守恒检查时才能提交。
- 机制尝试读取或声明超出允许路径的状态、返回未授权知识分类或过长 TTL 时测试失败。
- 相同 seed、Tick 和 Action 集仍得到与 M1 一致的确定性结果；资源总量、知识隔离、重放哈希测试继续通过。
- 编译后的机制契约参与 World Package 哈希，改变 Schema 或权限声明会改变 `packageHash`。
- `npm run check` 全部通过，且静态函数文档、项目进展、`CHANGELOG.md` 与 `todo.md` 同步更新。

## 影响范围

- `simulation/schemas/`：新增 Action/Effect Schema，扩展机制注册表与 World Package Schema。
- `simulation/compiler/world-package.mjs`：校验并编译具体 Action/Effect 契约和访问清单。
- `simulation/rules/`：统一结构校验、访问策略检查和 Effect 授权。
- `simulation/runtime/simulation-runtime.mjs`：按固定顺序执行契约、业务与权限校验。
- `simulation/registries/`、W99 场景及相关测试夹具：登记 `MEC-001` 的具体契约。
- `tests/`：增加 Schema、默认拒绝、越权读写、知识策略和兼容性测试。

## 未解决问题

- 外部 `/api/instances/...` 的认证、主体授权与速率限制不在本提案范围内。
- 组织成员共享、推断、欺骗和复杂传播网络仍属于后续知识系统设计。
- 是否长期使用自有受限 Schema 校验器，需在契约复杂度实际增长后重新评估。
- 细粒度字段脱敏与动态能力令牌留待出现跨区域、多资源或第三方机制需求时再设计。
