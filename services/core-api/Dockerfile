# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# npm workspaces require visibility of every workspace package.json,
# so all are copied here even though only core-api is built.

ARG NODE_VERSION=22

# ---- deps: install all workspace deps (incl. dev, needed for the build stage) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts

# ---- build: compile TS -> JS for shared-types and core-api ----
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY services/core-api/tsconfig.json services/core-api/
COPY services/core-api/src services/core-api/src
RUN npm run build --workspace=@mat-inspect/shared-types \
 && npm run build --workspace=@mat-inspect/core-api

# ---- prod-deps: install only production deps for the runtime image ----
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime: minimal image, non-root, prod node_modules + built JS ----
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /repo
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/package.json ./
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/services/core-api/package.json services/core-api/
COPY --from=build /repo/services/core-api/dist services/core-api/dist
USER appuser
WORKDIR /repo/services/core-api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
