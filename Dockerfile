FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs storage.mjs storage-migrations.mjs seedream.mjs comfyui.mjs ai-harness.mjs prompt-settings.mjs ./
COPY scripts/compile-world-package.mjs ./scripts/compile-world-package.mjs
COPY simulation/ ./simulation/
COPY dist/ ./dist/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
