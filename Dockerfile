# syntax=docker/dockerfile:1
#
# One file, three images (build with --target):
#   web     the Next.js server (standalone output, small)
#   worker  the background worker, also used for the one-off database migration
#
#   docker build --target web    -t app-web .
#   docker build --target worker -t app-worker .

FROM node:22-alpine AS base
# The Alpine image already has the OpenSSL libraries that Prisma needs. corepack gives us the pnpm
# version named in package.json.
RUN corepack enable
COPY docker/with-ca.sh /usr/local/bin/with-ca
WORKDIR /app

# All dependencies, to build the app.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    with-ca pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
# The build needs a secret to start, but nothing real: runtime values come from the environment.
RUN --mount=type=secret,id=extra_ca,required=false \
    with-ca sh -c 'BETTER_AUTH_SECRET=build-only-not-a-real-secret-0000000000 pnpm exec prisma generate && BETTER_AUTH_SECRET=build-only-not-a-real-secret-0000000000 pnpm build'

# Only what runs in production (the worker and the migration need these). The worker does not
# compile anything, so the build tools that Next.js and others bring along are removed.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    with-ca pnpm install --frozen-lockfile --prod \
    && rm -rf node_modules/.pnpm/@next+swc-* node_modules/.pnpm/@rolldown+* node_modules/.pnpm/typescript@*

# ---------------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/data/storage
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Files made by the app (logos, report PDFs, exports) live on a volume shared with the worker.
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production STORAGE_LOCAL_DIR=/data/storage
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json tsconfig.worker.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src
# The worker maps the "server-only" package to this empty file (see tsconfig.worker.json).
COPY --chown=node:node tests/stubs/server-only.ts ./tests/stubs/server-only.ts
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
CMD ["node_modules/.bin/tsx", "--tsconfig", "tsconfig.worker.json", "src/worker/index.ts"]
