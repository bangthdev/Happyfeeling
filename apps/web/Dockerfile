FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@happyfeeling/web..." build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

EXPOSE 3000
CMD ["pnpm", "--filter", "@happyfeeling/web", "start"]
