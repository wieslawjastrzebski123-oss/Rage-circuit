# RAGE CIRCUIT multiplayer server (authoritative race simulation over WebSocket)
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY src ./src
COPY server ./server
ENV NODE_ENV=production
# hosting platforms inject PORT; 8787 locally
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
