FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs agent-runtime.schema.json agent-profile-contract.mjs agent-profile-registry.mjs storage.mjs storage-migrations.mjs seedream.mjs comfyui.mjs reference-assets.mjs ai-content-specs.mjs ai-harness.mjs ai-tools.mjs ai-agent.mjs image-context.mjs prompt-settings.mjs ./
COPY scripts/compile-world-package.mjs ./scripts/compile-world-package.mjs
COPY simulation/ ./simulation/
COPY dist/ ./dist/

# Agent Profile 产品投影：只复制 Registry 需要读取的清单与提示文件。
# 不复制 agent.cordis.yml、preset.yml、skills/、.agent-presets/README.md 或任何设计目录。
COPY .agent-presets/card-designer/worldforge.runtime.json ./.agent-presets/card-designer/worldforge.runtime.json
COPY .agent-presets/card-designer/runtime/system.md ./.agent-presets/card-designer/runtime/system.md
COPY .agent-presets/free-creator/worldforge.runtime.json ./.agent-presets/free-creator/worldforge.runtime.json
COPY .agent-presets/free-creator/runtime/system.md ./.agent-presets/free-creator/runtime/system.md
COPY .agent-presets/lore-writer/worldforge.runtime.json ./.agent-presets/lore-writer/worldforge.runtime.json
COPY .agent-presets/lore-writer/runtime/system.md ./.agent-presets/lore-writer/runtime/system.md

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
