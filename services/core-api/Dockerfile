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
COPY packages/shared-auth-server/package.json packages/shared-auth-server/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-crypto/package.json packages/shared-crypto/
COPY db/package.json db/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts

# ---- build: compile TS -> JS for core-api and its project references ----
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY db db
COPY services/core-api/tsconfig.json services/core-api/
COPY services/core-api/src services/core-api/src
# tsc -b walks the project references (shared-types, shared-schemas, db) in
# dependency order. Plain per-workspace `tsc` does not build references and
# fails on the db reference (TS6053/TS6305).
RUN npx tsc -b services/core-api/tsconfig.json

# ---- prod-deps: install only production deps for the runtime image ----
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-auth-server/package.json packages/shared-auth-server/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-crypto/package.json packages/shared-crypto/
COPY db/package.json db/
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
COPY --from=build /repo/packages/shared-auth-server/package.json packages/shared-auth-server/
COPY --from=build /repo/packages/shared-auth-server/dist packages/shared-auth-server/dist
COPY --from=build /repo/packages/shared-schemas/package.json packages/shared-schemas/
COPY --from=build /repo/packages/shared-schemas/dist packages/shared-schemas/dist
COPY --from=build /repo/packages/shared-crypto/package.json packages/shared-crypto/
COPY --from=build /repo/packages/shared-crypto/dist packages/shared-crypto/dist
COPY --from=build /repo/services/core-api/package.json services/core-api/
COPY --from=build /repo/services/core-api/dist services/core-api/dist
# fastify-type-provider-zod pins a peer range that blocks npm from hoisting it to
# the root node_modules, so it stays in the workspace-local node_modules. The root
# copy above misses it and the runtime crashes with ERR_MODULE_NOT_FOUND. Ship the
# workspace-local node_modules too (DEV-58).
COPY --from=prod-deps /repo/services/core-api/node_modules services/core-api/node_modules
# core-api imports the Drizzle schema via the @mat-inspect/db workspace package.
# prod-deps symlinks node_modules/@mat-inspect/db -> ../../db, so ship the package
# manifest and its emitted output at that target.
COPY --from=build /repo/db/package.json db/
COPY --from=build /repo/db/dist db/dist
# The migration SQL, next to the compiled migrator that looks for it. tsc emits .js and copies
# nothing else, so without this the image ships db/dist/migrate.js pointing at a migrations folder
# that is not there, and a box with only the images cannot create its schema (DEV-97).
COPY --from=build /repo/db/migrations db/dist/migrations
USER appuser
WORKDIR /repo/services/core-api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
