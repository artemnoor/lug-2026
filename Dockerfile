# Runtime images are split by deployment unit. Compose selects a target.

FROM python:3.11-slim AS python-deps
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
RUN python -m venv /opt/venv
COPY apps/api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

FROM python:3.11-slim AS api-runtime
ARG BUILD_SHA=unknown
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/apps/api PATH="/opt/venv/bin:$PATH"
ENV LUG_BUILD_SHA=$BUILD_SHA
WORKDIR /app
COPY --from=python-deps /opt/venv /opt/venv
COPY apps/api ./apps/api
COPY packages ./packages
COPY scripts ./scripts
RUN useradd --create-home --uid 10001 lug \
    && mkdir -p /var/lib/lug/data /var/lib/lug/upload-tmp /var/lib/lug/uploads \
    && chown -R lug:lug /app /var/lib/lug
USER lug
EXPOSE 4174

FROM api-runtime AS api
CMD ["python", "-B", "-m", "uvicorn", "app.main:app", "--app-dir", "apps/api", "--host", "0.0.0.0", "--port", "4174", "--no-access-log"]

FROM api-runtime AS worker
CMD ["python", "-B", "-m", "app.worker"]

FROM api-runtime AS migrate
CMD ["python", "-B", "scripts/migrate.py"]

FROM node:22-bookworm-slim AS web-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY apps/web ./apps/web
COPY scripts ./scripts
RUN npm run build:web

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
ENV LUG_WEB_ROOT=/app/apps/web/dist
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY apps/web/server.js ./apps/web/server.js
COPY apps/web/src ./apps/web/src
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
COPY packages ./packages
RUN useradd --create-home --uid 10001 lug && chown -R lug:lug /app
USER lug
EXPOSE 4173
CMD ["node", "apps/web/server.js"]
