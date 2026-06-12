# syntax=docker/dockerfile:1.7
# Build context is the repo root (see docker-compose.yml).
# npm workspaces require visibility of every workspace package.json,
# so all are copied here even though only the dashboard is built.

ARG NODE_VERSION=22

# ---- deps: install all workspace deps (incl. dev, needed for the build stage) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts

# ---- build: compile the Next.js app to a standalone server ----
FROM deps AS build
# The dashboard imports @mat-inspect/shared-types, which tsconfig paths resolve to
# packages/shared-types/src. The build needs those sources, not just the package.json
# copied into the deps stage (dist is dockerignored and never built here).
COPY packages packages
COPY apps/dashboard apps/dashboard
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_AZURE_TENANT_ID
ARG NEXT_PUBLIC_AZURE_CLIENT_ID
ENV NEXT_PUBLIC_AZURE_TENANT_ID=$NEXT_PUBLIC_AZURE_TENANT_ID
ENV NEXT_PUBLIC_AZURE_CLIENT_ID=$NEXT_PUBLIC_AZURE_CLIENT_ID
RUN npm run build --workspace=@mat-inspect/dashboard

# ---- runtime: standalone Next.js server, non-root ----
# outputFileTracingRoot is the repo root, so the standalone tree mirrors it:
# server.js lives at apps/dashboard/server.js with node_modules at the root.
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /repo
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
# The standalone server binds to HOSTNAME; Docker sets that to the container id,
# which leaves localhost unreachable. Bind all interfaces so the healthcheck works.
ENV HOSTNAME=0.0.0.0 PORT=3000
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/dashboard/server.js"]
