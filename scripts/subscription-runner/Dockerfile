FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.160.0 @anthropic-ai/claude-code@2.1.294 && npm cache clean --force
WORKDIR /runner
COPY --chown=node:node scripts/subscription-runner/server.mjs ./server.mjs
COPY --chown=node:node scripts/subscription-runner/catalog.mjs ./catalog.mjs
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
