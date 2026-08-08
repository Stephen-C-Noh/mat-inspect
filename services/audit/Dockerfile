# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# npm workspaces require visibility of every workspace package.json,
# so all are copied here even though only audit is built.

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

# ---- build: compile TS -> JS for audit and its project references ----
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY services/audit/tsconfig.json services/audit/
COPY services/audit/src services/audit/src
COPY services/audit/db services/audit/db
# tsc -b walks the project references (shared-types, shared-auth-server, shared-schemas,
# shared-crypto) in dependency order.
RUN npx tsc -b services/audit/tsconfig.json

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
COPY --from=build /repo/packages/shared-crypto/package.json packages/shared-crypto/
COPY --from=build /repo/packages/shared-crypto/dist packages/shared-crypto/dist
COPY --from=build /repo/services/audit/package.json services/audit/
COPY --from=build /repo/services/audit/dist services/audit/dist
# The migration SQL, next to the compiled migrator that looks for it. tsc emits .js and copies
# nothing else, so without this the image ships dist/db/migrate.js pointing at a migrations folder
# that is not there, and a box with only the images cannot create its schema (DEV-97).
COPY --from=build /repo/services/audit/db/migrations services/audit/dist/db/migrations
# GIT_SHA (DEV-99): the commit this image was built from, reported in /health so a deployed
# stack can be asked from outside whether every service is on the same commit and whether that
# commit is the head of main. ci.yml passes it as a build arg; docker-compose.yml's local build
# falls back to "local" when unset. Unknown by default so a hand build never lies about its origin.
# Placed after the COPY layers, not before: this value changes on every commit, and putting it
# earlier would bust BuildKit's cache for every COPY that follows it on every single build.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER appuser
WORKDIR /repo/services/audit
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/src/server.js"]
