FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=/manage
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
RUN npm run build

# node:sqlite 内置于 Node 24，无需额外安装原生数据库驱动。
FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS runner
WORKDIR /app
ARG NEXT_PUBLIC_BASE_PATH=/manage
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HOME=/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /data \
    && chown -R nextjs:nodejs /data

# 只拷贝 Next.js standalone 产物及其已追踪的 node_modules（约 20MB）。
# 不要拷贝 dependencies 阶段的全量 node_modules（约 500MB，含 devDependencies）。
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/database ./database

# standalone 追踪产物未包含 bcryptjs（它被打进服务端 chunk），
# 但 scripts/bootstrap.mjs 等启动脚本会直接 import，因此单独拷贝该包。
# bcryptjs 无传递依赖，单个包目录即可满足。
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs

COPY --chown=nextjs:nodejs docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]

# Build command:
# docker build --build-arg NEXT_PUBLIC_BASE_PATH=/manage -t axhub:latest .
