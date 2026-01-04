FROM node:20-alpine

WORKDIR /app

# Install deps for reminders_worker only
COPY apps/reminders_worker/package.json apps/reminders_worker/package-lock.json ./apps/reminders_worker/
RUN cd apps/reminders_worker && npm ci --omit=dev

# Copy shared core and app source (avoid copying node_modules from host)
COPY core ./core
COPY apps/reminders_worker/src ./apps/reminders_worker/src

WORKDIR /app/apps/reminders_worker
ENV NODE_ENV=production

CMD ["npm", "start"]


