[← Previous Page](getting-started.md) · [Back to README](../README.md) · [Configuration →](configuration.md)

# Архитектура сайта и кабинета

## Обзор

Публичная страница остаётся статическим HTML/CSS/JavaScript. Кабинет и админ-панель используют модульный FastAPI backend из `backend/`. В браузере нет базы данных и бизнес-правил авторизации: страница обращается к server API по относительному пути `/api`.

## Browser и локальный transport

| Путь | Назначение |
|------|------------|
| `index.html` | Публичная страница, окно авторизации и вход в кабинет |
| `src/components/auth-dialog.html` | Вход, регистрация с немедленным созданием сессии и восстановление пароля |
| `src/account/cabinet.html` | Кабинет участника |
| `src/account/admin.html` | Панель организатора |
| `src/account/css/` | Изолированные стили кабинета и админки с токенами палитры публичного сайта |
| `src/scripts/features/account/store.js` | Fetch-клиент, CSRF, upload и согласование формата API |
| `src/scripts/features/account/site-shell.js` | Вход/регистрация на публичной странице |
| `src/scripts/features/account/cabinet.js`, `admin.js` | Приложения участника и организатора |
| `scripts/build-site.mjs` | Раскрывает HTML include и копирует frontend runtime в `dist/` |
| `scripts/serve-site.mjs` | Отдаёт frontend на 4173 и проксирует `/api/*`, `/uploads/*` на API 4174 |
| `backend/app/main.py` | FastAPI composition root |
| `backend/app/modules/` | Вертикальные модули auth, users, teams, media, portfolio, video, notifications, content и admin |
| `backend/alembic/` | Миграции relational schema |
| `backend/docker-compose.yml` | Backend, PostgreSQL, Redis, MinIO, ClamAV и Mailpit для локальной разработки |

`backend/` — отдельный Git clone. Его backend-слои и API контракт описаны в [backend/ARCHITECTURE.md](../backend/ARCHITECTURE.md) и [compatibility matrix](../backend/docs/compatibility-matrix.md).

Кабинет, админ-панель и формы регистрации сверены с [frontend репозитория `lug-2026`](https://github.com/artemnoor/lug-2026/tree/2f8a8dc/apps/web/public). В проект перенесены только эти экраны и нужные им ресурсы; публичная главная страница остаётся собственной. Сохранены локальные пути, палитра и мобильные исправления. Поток регистрации намеренно отличается от upstream: после создания аккаунта пользователь сразу входит, подтверждение email не требуется, пароль требует только минимум 8 символов.

## Поток запроса

~~~text
Browser interface
    → same-origin /api or /uploads
    → local Node preview proxy (development only)
    → FastAPI router and dependency boundary
    → application service / domain policy
    → module port and repository adapter
    → PostgreSQL or private object storage
~~~

На staging/production reverse proxy должен направить `/api/*` и `/uploads/*` в API, сохранив same-origin cookie и HTTPS. `scripts/serve-site.mjs` предназначен только для локального preview.

## Сессия и безопасность

- API выдаёт opaque session cookie `lug_session` с HttpOnly и SameSite=Lax.
- Перед изменяющим запросом browser-клиент передаёт `X-CSRF-Token`, совпадающий с cookie `lug_csrf`.
- Backend применяет participant/admin/object-level permissions; форма в браузере не определяет право доступа.
- Загруженные документы выдаются по приватному owner/team/admin policy после антивирусной проверки.
- Portal выводит пользовательские/API строки только как текст и не сохраняет пароль в браузере.

## Сборка

Исходники frontend находятся в `src/`; `npm run build` пересоздаёт `dist/`. Python приложение, миграции и контейнерная конфигурация остаются в клонированном `backend/` и развиваются по его модульным границам.
