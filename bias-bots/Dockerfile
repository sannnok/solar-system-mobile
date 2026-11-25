FROM node:22-bookworm-slim
# ffmpeg — звук и простой стиль роликов; библиотеки ниже нужны headless-браузеру Remotion
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 \
    libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# скачать chrome-headless-shell для Remotion заранее, а не при первом ролике
RUN npx remotion browser ensure
COPY . .
ENV DB_PATH=/app/state/bots.db NODE_ENV=production
VOLUME ["/app/state"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/bias-bot/index.mjs"]
