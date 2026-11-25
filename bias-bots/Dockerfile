FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV DB_PATH=/app/state/bots.db NODE_ENV=production
VOLUME ["/app/state"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/bias-bot/index.mjs"]
