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

CMD ["pnpm", "--filter", "@b3-review/worker", "start"]
