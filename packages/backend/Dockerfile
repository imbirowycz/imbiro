FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend-vue-pwa/package.json packages/frontend-vue-pwa/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/backend packages/backend

RUN npm run build --workspace=@myorg/shared && npm run build --workspace=@myorg/backend

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/backend/dist/index.js"]
