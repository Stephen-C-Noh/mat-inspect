# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# npm workspaces require visibility of every workspace package.json,
# so all are copied here even though only the dashboard is built.

ARG NODE_VERSION=22

# ---- deps: install all workspace deps (incl. dev, needed for the build stage) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-auth/package.json packages/shared-auth/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts

# ---- build: compile the Next.js app to a standalone server ----
FROM deps AS build
# The dashboard imports @mat-inspect/shared-auth and @mat-inspect/shared-types, which
# tsconfig paths resolve to packages/*/src. The build needs those sources, not just the
# package.json copied into the deps stage (dist is dockerignored and never built here).
COPY packages packages
COPY apps/dashboard apps/dashboard
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_AZURE_TENANT_ID
ARG NEXT_PUBLIC_AZURE_CLIENT_ID
ENV NEXT_PUBLIC_AZURE_TENANT_ID=$NEXT_PUBLIC_AZURE_TENANT_ID
ENV NEXT_PUBLIC_AZURE_CLIENT_ID=$NEXT_PUBLIC_AZURE_CLIENT_ID
# next.config rewrites() bakes the /api/v1 proxy destination into routes-manifest.json at build
# time, so GATEWAY_URL must be present here, not just at runtime (ADR 0020).
ARG GATEWAY_URL
ENV GATEWAY_URL=$GATEWAY_URL
RUN npm run build --workspace=@mat-inspect/dashboard

# ---- runtime: standalone Next.js server, non-root ----
# outputFileTracingRoot is the repo root, so the standalone tree mirrors it:
# server.js lives at apps/dashboard/server.js with node_modules at the root.
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
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
# Next.js standalone output does not include public/ on its own; copy it separately.
COPY --from=build /repo/apps/dashboard/public ./apps/dashboard/public
# The standalone server binds to HOSTNAME; Docker sets that to the container id,
# which leaves localhost unreachable. Bind all interfaces so the healthcheck works.
ENV HOSTNAME=0.0.0.0 PORT=3000
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/dashboard/server.js"]
