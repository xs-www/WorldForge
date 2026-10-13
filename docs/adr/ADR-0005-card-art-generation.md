# ADR-0005：卡面候选图采用 Seedream / ComfyUI 双通道

- **状态**：canon
- **日期**：2026-10-13
- **范围**：HTML 产品的卡牌草案美术流程，不改变世界观或对战规则

## 背景

作者明确要求在卡牌制作中加入文生图，远程通道使用火山方舟 Seedream，本地通道使用 ComfyUI，并允许在生成前调用现有语言模型优化提示词。

## 决策

1. 火山方舟通道固定使用中国区 `POST /api/v3/images/generations`，默认模型为 `doubao-seedream-5-0-flash-260915`，返回 URL、2K、非流式并保留水印。
2. 本地 ComfyUI 通道接收用户导出的 API Format JSON。工作流必须包含 `{{PROMPT}}`，可选 `{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}` 与 `{{SEED}}`；服务端通过 `/prompt` 入队、`/history/{prompt_id}` 轮询，再用 `/view` 下载首张输出图。
3. 提示词优化是独立、显式操作。语言模型输出先回填编辑器，只有作者再次点击生成才会调用图像服务。
4. 远程临时 URL 必须立即下载。图片文件保存在服务端持久卷，SQLite `art_assets` 记录提示词、provider、模型、尺寸、MIME、文件名和生成元数据。
5. 所有 AI 图片均标记为 `proposed / ai_generated`；选择图片只绑定当前卡牌草案，不自动晋升正史，也不声明版权或商用授权。
6. API Key 只保存在本机服务配置，不进入前端缓存、SQLite 内容快照或 JSON 导出。

## 取舍与边界

- ComfyUI 节点、checkpoint 与自定义节点因本机环境而异，因此不内置假定模型的工作流；由作者粘贴已在本机验证的 API Format JSON。
- 首期只取工作流的第一张图片，不提供队列进度、中断、资产删除、参考图或图生图。
- 自动测试全部使用 mock，不触发真实付费 API，也不声称已验证用户本地的 ComfyUI 模型环境。
