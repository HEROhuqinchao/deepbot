# DeepBot Web Server - Docker 镜像
# 支持 linux/amd64 和 linux/arm64（buildx 多架构）

# ---- 构建阶段 ----
FROM node:22-bookworm-slim AS builder

# 安装编译工具（better-sqlite3 原生编译需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package 文件，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml .npmrc ./

# 安装 pnpm
RUN npm install -g pnpm@10.23.0 --registry=https://registry.npmmirror.com

# 安装依赖（跳过 postinstall 中的 electron-rebuild，服务端不需要 Electron）
RUN SKIP_ELECTRON_REBUILD=1 pnpm install --frozen-lockfile \
    --ignore-scripts \
    && pnpm rebuild better-sqlite3

# 复制源码
COPY . .

# 构建 web server 和前端
RUN pnpm run build:web

# ---- 运行阶段 ----
FROM node:22-bookworm-slim

# 安装运行时依赖：Python 3.11、pip、Playwright 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    # Playwright Chromium 运行时依赖
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# 安装 pnpm
RUN npm install -g pnpm@10.23.0 --registry=https://registry.npmmirror.com

WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/dist-web ./dist-web
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/main/prompts ./src/main/prompts

# 安装 Playwright 并下载 Chromium（构建时预装，避免运行时下载）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps 2>/dev/null || \
    node -e "require('playwright').chromium.launch().then(b=>b.close())" 2>/dev/null || true

# 创建数据目录（volume 挂载点）
RUN mkdir -p /data/workspace /data/skills /data/memory /data/sessions /data/db

# 设置 Docker 模式标识
ENV DEEPBOT_DOCKER=true
ENV NODE_ENV=production

# Web server 端口
EXPOSE 3000

# 启动命令
CMD ["node", "-r", "dotenv/config", "dist-server/server/index.js", "dotenv_config_path=/app/.env"]
