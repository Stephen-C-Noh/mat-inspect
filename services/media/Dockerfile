# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# npm workspaces require visibility of every workspace package.json,
# so all are copied here even though only media is built.

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

# ---- build: compile TS -> JS for media and its project references ----
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY services/media/tsconfig.json services/media/
COPY services/media/src services/media/src
# tsc -b walks the project references (shared-types, shared-schemas) in dependency order.
RUN npx tsc -b services/media/tsconfig.json

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
# Security hardening (DEV-42). apk upgrade pulls the patched OpenSSL (libssl3/libcrypto3,
# CVE-2026-45447) from the alpine branch. Removing the bundled npm CLI clears the HIGH/CRITICAL
# CVEs in npm's own vendored deps (tar, sigstore, brace-expansion, picomatch): the runtime only
# runs `node`, never npm, so npm is dead weight. Not version-pinned on purpose, so each base-image
# security bump is picked up instead of frozen at the tag's first build.
RUN apk --no-cache upgrade \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/package.json ./
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/shared-auth-server/package.json packages/shared-auth-server/
COPY --from=build /repo/packages/shared-auth-server/dist packages/shared-auth-server/dist
COPY --from=build /repo/packages/shared-schemas/package.json packages/shared-schemas/
COPY --from=build /repo/packages/shared-schemas/dist packages/shared-schemas/dist
COPY --from=build /repo/services/media/package.json services/media/
COPY --from=build /repo/services/media/dist services/media/dist
# Unlike core-api and audit, every media production dependency (fastify, @fastify/multipart,
# fastify-type-provider-zod, @azure/storage-blob) hoists to the root node_modules copied above,
# so there is no workspace-local node_modules to ship. If a future dependency conflict forces a
# nested copy, add: COPY --from=prod-deps /repo/services/media/node_modules services/media/node_modules
# GIT_SHA (DEV-99): the commit this image was built from, reported in /health so a deployed
# stack can be asked from outside whether every service is on the same commit and whether that
# commit is the head of main. ci.yml passes it as a build arg; docker-compose.yml's local build
# falls back to "local" when unset. Unknown by default so a hand build never lies about its origin.
# Placed after the COPY layers, not before: this value changes on every commit, and putting it
# earlier would bust BuildKit's cache for every COPY that follows it on every single build.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER appuser
WORKDIR /repo/services/media
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
