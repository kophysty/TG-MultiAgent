FROM node:20-alpine

WORKDIR /app

# ffmpeg is required for voice pipeline (convert Telegram voice to wav 16k mono).
RUN apk add --no-cache ffmpeg

# Install deps for shared core
COPY core/package.json core/package-lock.json ./core/
RUN cd core && npm ci --omit=dev

# Install deps for todo_bot only
COPY apps/todo_bot/package.json apps/todo_bot/package-lock.json ./apps/todo_bot/
RUN cd apps/todo_bot && npm ci --omit=dev

# Copy shared core and app source (avoid copying node_modules from host)
COPY core ./core
COPY apps/todo_bot/src ./apps/todo_bot/src
COPY execution_history ./execution_history

WORKDIR /app/apps/todo_bot
ENV NODE_ENV=production

CMD ["npm", "start"]



