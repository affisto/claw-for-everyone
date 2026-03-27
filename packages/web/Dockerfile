FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY packages/web/package.json packages/web/
COPY packages/shared-db/package.json packages/shared-db/

RUN pnpm install --frozen-lockfile

COPY packages/shared-db/ packages/shared-db/
COPY packages/web/ packages/web/

RUN cd packages/shared-db && pnpm build
RUN cd packages/web && pnpm build

EXPOSE 3000

CMD ["pnpm", "--filter", "@claw/web", "start"]
