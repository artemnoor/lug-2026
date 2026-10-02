FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html ./index.html
COPY src ./src
COPY scripts/build-site.mjs ./scripts/build-site.mjs
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    LUG_WEB_HOST=0.0.0.0 \
    PORT=4173 \
    LUG_API_HOST=backend \
    LUG_API_PORT=8000

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts/serve-site.mjs ./scripts/serve-site.mjs

USER node
EXPOSE 4173

CMD ["node", "scripts/serve-site.mjs"]
