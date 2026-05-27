# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# server.js currently has no dependencies, but the workspace-aware install
# is in place so the first added dep does not silently fail at runtime.

ARG NODE_VERSION=22

# ---- prod-deps: install only production deps (workspace-aware) ----
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /repo
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/package.json ./
COPY services/media/package.json services/media/
COPY services/media/server.js services/media/
USER appuser
WORKDIR /repo/services/media
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
