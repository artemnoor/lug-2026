[← Previous Page](architecture.md) · [Back to README](../README.md)

# Конфигурация проекта

## Локальный backend

Для единого Docker Compose используйте `.env` в корне проекта. Скопируйте `.env.example`, задайте `LUG_ADMIN_EMAIL` и `LUG_ADMIN_PASSWORD`; Git игнорирует локальный `.env`. Остальные параметры локальных Postgres, Redis, MinIO, ClamAV и Mailpit заданы в `docker-compose.yml` и предназначены только для разработки. Параметры прямого backend-запуска перечислены в `backend/.env.example`.

Задайте уникальные `LUG_ADMIN_EMAIL` и `LUG_ADMIN_PASSWORD` до первого запуска. Compose публикует сайт и API только на loopback (`127.0.0.1:4173` и `127.0.0.1:4174`); Mailpit UI доступен на `127.0.0.1:8025`. MinIO использует внутренний адрес `minio:9000`; ни S3 API на `9000`, ни консоль на `9001` не публикуются на хост. Настройки staging/production описаны в [backend security guide](../backend/docs/security.md) и [operations runbook](../backend/docs/operations.md).

## Frontend API

Browser-клиент использует same-origin `/api` и `/uploads`. Для локального запуска Node preview маршрутизирует их на API. В Docker Compose адрес задают `LUG_API_HOST=backend` и внутренний порт `8000`. На внешнем хостинге настройте эквивалентное reverse proxy правило или раздавайте API под тем же origin. Не помещайте service token или backend secret в JavaScript.

## GitHub MCP в Codex

`.codex/config.toml` содержит конфигурацию запуска GitHub MCP через `npx`. Токен в файл не записывается. Если среде Codex нужен доступ к GitHub, передайте `GITHUB_TOKEN` через защищённую переменную окружения.
