FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
