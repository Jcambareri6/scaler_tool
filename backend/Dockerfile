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

# Graficos animados (motion/, Remotion): dependencias aparte, componentes
# compilados una sola vez (build/) y el Chrome Headless Shell que usa para
# renderizar, bajado aca para no hacerlo en el primer render.
COPY motion/package.json motion/package-lock.json ./motion/
RUN cd motion && npm ci --no-audit --no-fund
COPY motion ./motion
RUN cd motion && npm run build && npm run ensure-browser

FROM node:20-bookworm-slim
# Fuentes para los subtitulos quemados (filtro `subtitles` de ffmpeg/libass,
# ver renderVideo.tool.ts): el estilo pide Arial y fontconfig la resuelve a
# Liberation Sans (misma metrica). Sin fuentes instaladas los subtitulos
# salen vacios o ffmpeg falla.
# Las librerias lib* son las que necesita el Chrome Headless Shell de
# Remotion (motion/); las fuentes de los graficos vienen en su bundle.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-liberation ca-certificates \
     libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
     libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    WORK_DIR=/data/work
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/motion ./motion
RUN mkdir -p /data/work && chown -R node:node /data
USER node
CMD ["node", "dist/worker.js"]
