# apps/worker/Dockerfile
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @b3-review/db exec prisma generate
RUN pnpm --filter "@b3-review/worker..." build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

# node as PID 1 (not `pnpm start`) so Docker's SIGTERM reaches the worker
# directly. Going through pnpm relies on it forwarding the signal to its child,
# which the graceful shutdown in src/index.ts must not depend on.
CMD ["node", "apps/worker/dist/index.js"]
