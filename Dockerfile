FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
COPY --chown=node:node worker ./worker
COPY --chown=node:node scripts/database.mjs ./scripts/database.mjs
COPY --chown=node:node drizzle ./drizzle
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/when2meet.sqlite
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
