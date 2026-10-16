# WorldForge Agent Presets

本目录保存可随仓库版本化的 DSH Agent preset。每个一级子目录都是一个完整 preset：

```text
.agent-presets/
└─ <preset-id>/
   ├─ agent.cordis.yml
   ├─ preset.yml
   └─ skills/
```

当前提供：

- `card-designer`：只面向 WorldForge 卡牌、关键词与机制草案的内容设计模式。
- `lore-writer`：对应产品内结构化设定写作助手，按条目类型与内容块产出可回填候选。
- `free-creator`：对应产品内自由创作聊天，以自然语言讨论并按需只读检索仓库。

`free-creator` 的只读行为由 persona 约束；若需要权限层面的强制只读，请同时选择 DSH 的只读 permission preset。DSH preset 不会自动连接 WorldForge 产品运行时的 SQLite 资料库、美术资产索引或聊天附件。

## 在 DSH 中使用

DSH 默认扫描用户目录下的 `<dshHome>/.agent-presets`。若要直接使用仓库中的版本，应把本目录配置为受信任的 preset root；也可以从 DSH 的 Agent preset 设置中复制该 preset 到用户目录。不要维护两个互相漂移的手工副本。

启动会话时应把工作目录设为 WorldForge 仓库根目录。preset 的 persona 使用运行时 `{{cwd}}`，技能中的文件路径全部相对仓库根目录，因此仓库移动后无需改写绝对路径。

修改 `skills/` 后，已经运行的 DSH 会话不会自动取得新版本；请重启 Profile 或同时触碰 `agent.cordis.yml` 后新建会话。

