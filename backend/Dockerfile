# TrustMesh backend.
#
# Multi-stage: the build stage needs TypeScript and the rest of devDependencies,
# the runtime stage must not ship them. The final image carries compiled JS,
# production dependencies and nothing else — no source, no compiler, no test
# runner. That matters here beyond image size: every current `npm audit` finding
# in this project is in the vitest/vite/esbuild toolchain, and none of it belongs
# anywhere near a running service.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests alone first so `npm ci` is cached and only re-runs when the
# dependency set actually changes, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `npm ci --omit=dev` against the same lockfile — the runtime dependency tree is
# resolved identically to the build, just without the dev half.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Applied by `npm run migrate` (node-pg-migrate) as a separate step, not at
# container start: a service that silently migrates on boot will happily do so
# from several replicas at once.
COPY migrations ./migrations

# The node image ships an unprivileged `node` user. The checkpoint directory is
# the only path the process writes to, so it is the only thing it needs to own.
RUN mkdir -p /app/state && chown -R node:node /app/state
USER node

ENV FABRIC_CHECKPOINT_FILE=/app/state/fabric-checkpoint.json
EXPOSE 4000

# /health answers without touching the ledger or the database, so it reports
# "the process is up" rather than "every dependency is up" — which is what a
# container healthcheck should mean. /health/chain is the deeper probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
