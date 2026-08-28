FROM node:22-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/api \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates clamav clamav-daemon python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

WORKDIR /app
COPY apps/api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY package*.json ./
RUN npm ci --omit=dev

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY deploy ./deploy
COPY server.js README.md ./

RUN mkdir -p /var/lib/lug/data /var/lib/lug/upload-tmp /var/lib/lug/uploads \
    && chmod 755 /app/deploy/clamdscan-remote.sh \
    && chown -R node:node /app /var/lib/lug

USER node
EXPOSE 4173
CMD ["node", "server.js"]
