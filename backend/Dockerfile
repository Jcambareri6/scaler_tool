# Imagen del worker de render (src/worker.ts) -- NO de la API: la API sigue
# deployandose en Render con su build nativo de Node (ver render.yaml).
# Se usa con docker-compose.worker.yml; ver WORKER_DEPLOY.md.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# ffmpeg-static baja su binario (estatico, no necesita librerias del
# sistema) durante el install.
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
# Fuentes para los subtitulos quemados (filtro `subtitles` de ffmpeg/libass,
# ver renderVideo.tool.ts): el estilo pide Arial y fontconfig la resuelve a
# Liberation Sans (misma metrica). Sin fuentes instaladas los subtitulos
# salen vacios o ffmpeg falla.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    WORK_DIR=/data/work
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/work && chown -R node:node /data
USER node
CMD ["node", "dist/worker.js"]
