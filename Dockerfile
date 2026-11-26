# 星芽学堂 · 单容器部署（无外部数据库/缓存依赖）
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PUBLIC_URL=http://localhost:8080

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY docs ./docs
RUN apk add --no-cache su-exec \
  && mkdir -p /data/snapshots \
  && chown -R node:node /data /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.ts"]
