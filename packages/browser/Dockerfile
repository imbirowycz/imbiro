# Obraz Playwright ma Chromium i wszystkie biblioteki systemowe w wersji zgodnej z playwright-core.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY packages/browser/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY packages/browser/*.mjs ./
ENV NODE_ENV=production \
    PORT=3100 \
    BROWSER_PROFILE_DIR=/data/profile
# Użytkownik bez uprawnień roota (jest w obrazie Playwright).
RUN mkdir -p /data/profile && chown -R pwuser:pwuser /data
USER pwuser
EXPOSE 3100
CMD ["node", "server.mjs"]
