FROM node:24.19.0-bookworm-slim AS build
WORKDIR /findlink
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /findlink
COPY --from=build --chown=node:node /findlink/package.json ./
COPY --from=build --chown=node:node /findlink/node_modules ./node_modules
COPY --from=build --chown=node:node /findlink/dist ./dist
USER node
CMD ["node", "dist/backend/index.js"]
