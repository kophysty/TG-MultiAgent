FROM node:20-alpine

WORKDIR /app

# Install deps for todo_bot only
COPY apps/todo_bot/package.json apps/todo_bot/package-lock.json ./apps/todo_bot/
RUN cd apps/todo_bot && npm ci --omit=dev

# Copy shared core and app source (avoid copying node_modules from host)
COPY core ./core
COPY apps/todo_bot/src ./apps/todo_bot/src

WORKDIR /app/apps/todo_bot
ENV NODE_ENV=production

CMD ["npm", "start"]



