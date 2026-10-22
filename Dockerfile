FROM node:22-bookworm-slim

# Chrome Headless Shell runtime deps (Remotion ships its own ffmpeg) + fallback fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
      fonts-noto-core ca-certificates ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npx remotion browser ensure

RUN useradd -m renderer && mkdir -p data && chown -R renderer:renderer /app
USER renderer

ENV PORT=3005 NODE_ENV=production
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD curl -fsS http://127.0.0.1:3005/health || exit 1
CMD ["npx", "tsx", "server/render-server.ts"]
