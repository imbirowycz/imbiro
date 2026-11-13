FROM node:22-alpine
WORKDIR /app
COPY packages/home-relay/package.json packages/home-relay/*.mjs ./
ENV NODE_ENV=production AGENT_PORT=3300 PROXY_PORT=3128
USER node
EXPOSE 3300 3128
CMD ["node", "relay.mjs"]
