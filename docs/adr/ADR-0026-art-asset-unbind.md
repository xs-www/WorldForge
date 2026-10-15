# ADR-0026：美术资产可以解除绑定

- 状态：canon（技术边界）
- 日期：2026-10-15
- 决策者：作者
- 来源：作者指出视觉原型里的画作无法解除绑定（关联卡牌可以）

## 背景

设定条目的「关联卡牌」早已有解除入口（`unbindCardFromLore()` 从卡牌 `loreRefs` 中移除当前条目），行为验证通过。但「视觉原型」里的画作只有一个查看按钮：客户端没有解除函数，服务端 `/api/art-assets` 只有两个 `GET` 路由，没有任何修改接口。

美术资产有两种不同的绑定方式：卡牌原画记在卡牌草稿的 `artAssetId` 上（客户端数据），设定视觉原型记在资产自身的 `targetType` / `targetId` 上（服务端元数据）。前者的「取消选择」缺一个入口，后者根本没有解绑路径。

## 决策

1. `art_assets` 元数据新增 `unbound` 标记。`normalizeArtAsset()` 在 `unbound === true` 或 `targetType` 为空时把 `targetType`、`targetId`、`cardId` 一并清空。**解除绑定不删除图片文件与资产记录**：画作留在素材库的「未使用原画」分类里，随时可以再用。
2. `createContentStore()` 新增 `setArtAssetTarget(id, target)`：`target` 为空或缺少 `targetId` 时解除绑定，否则重新绑定到指定目标；资产不存在时返回 `null`。写入同时更新 `card_id` 列与 `metadata_json`。
3. 服务端新增 `POST /api/art-assets/:id/unbind`，沿用既有的 `X-Worldforge-Image: 1` 请求标记守卫；成功返回更新后的资产，资产不存在返回 404。
4. 设定视觉原型的每个候选新增「解除绑定」按钮，确认后调用该接口，并在本地把资产标记为未绑定，重绘视觉原型、自由对话附件托盘与原画集。
5. 卡牌编辑器新增「不使用原画」，把 `selectedArtAssetId` 置空并重绘卡面——此前一旦点选过候选就无法取消。
6. `prepareArtAssets()` 不再把未知 `targetType` 兜底成 `card`，改为原样保留空值，避免已解绑的资产被 Agent 当成卡牌原画。

## 边界

- 只解除关系，不删除文件。真正的素材删除（含磁盘文件回收）不在本次范围。
- 不做批量解除，也不提供「解除全部」。
- 解除后该画作仍可被 Agent 检索与查看（它仍在素材库里），只是不再属于任何条目。

## 影响范围

- `storage.mjs`、`server.mjs`、`ai-tools.mjs`、`dist/app.js`、`dist/index.html`、`dist/styles.css`
- `tests/storage.test.mjs`、`tests/subpath-routing.test.mjs`

## 未解决问题

- 素材删除与磁盘文件回收仍未实现（原 TODO 项保留）。
- 解除后没有「最近解除」入口，需要去原画集的未使用分类里找。
- 服务端成功路径未对作者的真实素材库做破坏性验证，只验证了守卫与 404 分支；持久化语义由存储层测试覆盖。
