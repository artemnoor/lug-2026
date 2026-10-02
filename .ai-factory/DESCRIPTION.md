# Контекст проекта

## Обзор

Сайт конкурса «Лучшая учебная группа» МГТУ им. Н. Э. Баумана. Содержит публичные страницы, личный кабинет участника и защищённую админ-панель. Frontend остаётся статической страницей без сборочного framework; пользовательские данные и все права доступа принадлежат backend.

## Технологии

- **Frontend:** HTML5, локальный Webflow CSS, проектный CSS, vanilla browser JavaScript.
- **Portal API client:** `src/scripts/features/account/store.js`; запросы идут на same-origin `/api`, изменяющие операции передают CSRF header.
- **Личный кабинет и админ-панель:** `src/account/` и `src/scripts/features/account/`; стили используют отдельную палитру, согласованную с главной страницей.
- **Вход и регистрация:** `src/components/auth-dialog.html` и `src/scripts/features/account/site-shell.js`.
- **Backend:** отдельный clone `backend/`, Python 3.11+, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic.
- **Backend architecture:** modular monolith с вертикальными модулями auth, users, teams, media, portfolio, video, notifications, content и admin.
- **Хранилище:** PostgreSQL для relational данных; MinIO/S3 для приватных загрузок; Redis для shared rate limiting.
- **Инфраструктура upload/email:** ClamAV и SMTP; локальная Compose-среда использует Mailpit.
- **Разработка frontend:** Node.js без frontend runtime/build dependencies; `scripts/serve-site.mjs` обслуживает preview и проксирует `/api/*` и `/uploads/*` к backend.
- **Проверки:** Playwright frontend regression suite и backend pytest/ruff/mypy команды.

## Основные пользовательские сценарии

- Регистрация капитана команды и присоединение к команде по invite.
- Подтверждение email, вход, восстановление пароля и отзыв других сессий.
- Изменение профиля и команды, отправка достижений и командного видео.
- Просмотр статусов проверки и уведомлений.
- Админская проверка команд, участников, портфолио и видео; настройка сроков, рассылка и аудит.

## Архитектурные границы

- Frontend вызывает только HTTP API контракт, описанный backend OpenAPI; браузерные модули не импортируют Python code.
- FastAPI `api` адаптеры работают через application services; предметные правила располагаются в доменных/application слоях, доступ к данным — за module ports/repositories.
- Сессии, роли, CSRF, валидация, ownership и сканирование файлов проверяются backend.
- В dev frontend и backend работают на localhost портах 4173 и 4174. Preview proxy обеспечивает same-origin browser requests.
- Production требует reverse proxy на `/api` и `/uploads`, HTTPS, настроенную приватную инфраструктуру и секреты из окружения.

## Структура

~~~text
src/components/                     # public shell, navigation and auth dialog
src/sections/                       # public content
src/account/                        # participant cabinet and organizer admin pages
src/scripts/features/account/       # account applications, API and feature modules
src/styles/auth-dialog.css          # public auth and registration dialog
scripts/serve-site.mjs              # local static server and API proxy
backend/app/modules/                # backend business modules and HTTP adapters
backend/app/core/                   # composition, config, security and HTTP policy
backend/alembic/                    # database migrations
~~~

Подробная backend схема и ограничения указаны в `backend/ARCHITECTURE.md`, `backend/docs/security.md` и `docs/architecture.md`.
