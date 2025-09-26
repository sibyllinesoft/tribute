FROM node:20-alpine

ENV NODE_ENV=production \
    TRIBUTE_API_KEY=local-dev-secret

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
