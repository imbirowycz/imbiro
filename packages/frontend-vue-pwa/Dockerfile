FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend-vue-pwa/package.json packages/frontend-vue-pwa/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/frontend-vue-pwa packages/frontend-vue-pwa

RUN npm run build --workspace=@myorg/frontend-vue-pwa

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/packages/frontend-vue-pwa/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
