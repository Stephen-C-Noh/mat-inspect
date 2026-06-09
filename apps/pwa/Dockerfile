# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

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

FROM deps AS build
WORKDIR /repo
COPY packages packages
COPY apps/pwa apps/pwa
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
