FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim
ENV TZ=Asia/Seoul \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
