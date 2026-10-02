[← Previous Page](architecture.md) · [Back to README](../README.md)

# Конфигурация проекта

## Локальный backend

Runtime настройки backend находятся в `backend/.env`. Файл игнорируется Git и не должен содержать пароли в tracked-конфигурации. `backend/.env.example` перечисляет доступные параметры; Compose задаёт dev-only значения для Postgres, Redis, MinIO, ClamAV и Mailpit.

Задайте уникальные `LUG_ADMIN_EMAIL` и `LUG_ADMIN_PASSWORD` до первого запуска. Локальный Compose публикует API только на `127.0.0.1:4174`; Mailpit UI доступен на `127.0.0.1:8025`. Настройки staging/production описаны в [backend security guide](../backend/docs/security.md) и [operations runbook](../backend/docs/operations.md).

## Frontend API

Browser-клиент использует same-origin `/api` и `/uploads`. Для локального запуска Node preview маршрутизирует их на `127.0.0.1:4174`. На внешнем хостинге необходимо настроить эквивалентное reverse proxy правило или раздавать API под тем же origin. Не помещайте service token или backend secret в JavaScript.

## AI Factory

Настройки рабочих процессов находятся в `.ai-factory/config.yaml`; архитектурный контекст проекта обновлён в `.ai-factory/DESCRIPTION.md` и `.ai-factory/ARCHITECTURE.md`.

## GitHub MCP в Codex

`.codex/config.toml` содержит конфигурацию запуска GitHub MCP через `npx`. Токен в файл не записывается. Если среде Codex нужен доступ к GitHub, передайте `GITHUB_TOKEN` через защищённую переменную окружения.
