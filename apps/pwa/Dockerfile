# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY packages/shared-auth/package.json packages/shared-auth/
COPY services/core-api/package.json services/core-api/
COPY services/media/package.json services/media/
COPY services/audit/package.json services/audit/
COPY apps/pwa/package.json apps/pwa/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --ignore-scripts

FROM deps AS build
WORKDIR /repo
COPY packages packages
COPY apps/pwa apps/pwa
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_AZURE_TENANT_ID
ARG NEXT_PUBLIC_AZURE_CLIENT_ID
ENV NEXT_PUBLIC_AZURE_TENANT_ID=$NEXT_PUBLIC_AZURE_TENANT_ID
ENV NEXT_PUBLIC_AZURE_CLIENT_ID=$NEXT_PUBLIC_AZURE_CLIENT_ID
# next.config rewrites() bakes the /api/v1 proxy destination into routes-manifest.json
# at build time, so CORE_API_URL must be present here, not just at runtime.
ARG CORE_API_URL
ENV CORE_API_URL=$CORE_API_URL
RUN npm run build --workspace=@mat-inspect/pwa

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /repo/apps/pwa/.next/standalone ./
COPY --from=build /repo/apps/pwa/.next/static ./apps/pwa/.next/static
ENV HOSTNAME=0.0.0.0 PORT=3000
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/pwa/server.js"]
