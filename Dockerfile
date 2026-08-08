FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY src/core ./src/core

USER node
EXPOSE 8787
CMD ["node", "server/index.js"]

