# Архитектура frontend и подключённого backend

## Обзор

Frontend — статический HTML/CSS/JavaScript сайт. Главная страница сохраняет оригинальный дизайн проекта; кабинет участника, регистрация и админ-панель используют перенесённые интерфейсы в отдельной frontend-структуре и API в клонированном `backend/`. Backend отвечает за identity, бизнес-правила, persistence, доступ к файлам и привилегии; browser UI отвечает за ввод и отображение.

## Структура

~~~text
.
├── index.html                         # Public page and auth dialog entry point
├── src/
│   ├── components/                    # Шапка, меню и окно авторизации
│   ├── sections/                      # Публичные разделы и CTA
│   ├── account/                       # Кабинет и админка с отдельными CSS/resources
│   ├── styles/                        # Public styles and auth dialog styles
│   └── scripts/features/account/      # API boundary, auth, cabinet and admin modules
├── scripts/
│   ├── build-site.mjs                 # Static HTML build
│   └── serve-site.mjs                 # Preview + local `/api` proxy
├── backend/
│   ├── app/main.py                    # FastAPI composition root
│   ├── app/core/                      # Config, security, HTTP and UoW
│   ├── app/modules/                   # Vertical application modules
│   ├── app/db/                        # SQLAlchemy models
│   ├── alembic/                       # Explicit database migrations
│   └── docker-compose.yml             # API + local dependencies
└── docs/                              # Local startup and integration notes
~~~

## Backend dependency direction

Backend modules follow the upstream modular-monolith rules documented in `backend/ARCHITECTURE.md`:

~~~text
FastAPI API adapters → application operations → domain and ports
composition root → concrete infrastructure adapters
infrastructure adapters → module ports
~~~

API adapters handle HTTP parsing, auth dependencies and response projections. Application services own use cases and transactions. Domain policies remain independent of FastAPI and SQLAlchemy. Repository and infrastructure adapters provide database, object storage, mail and rate-limiting implementations. Admin operations delegate mutations back to their domain-owning module.

## Frontend/backend boundary

- Browser code uses only typed JSON contracts exposed through `/api`; it does not know database tables or call backend modules directly.
- `src/scripts/features/account/store.js` adds `lug_csrf` as `X-CSRF-Token` for state-changing requests and relies on same-origin `lug_session` cookies.
- `scripts/serve-site.mjs` proxies API and private upload paths in local development. In deployment, configure an HTTPS reverse proxy that preserves cookies and request bodies for the same paths.
- User text is escaped before rendering; backend authorization remains mandatory even when UI hides an unavailable action.

## Identity, file and admin security

Opaque session token hashes, HttpOnly session cookies, CSRF, password hashing, rate limits, upload limits, antivirus scan status, ownership checks and admin role checks are backend responsibilities. Secrets belong in ignored `backend/.env` locally and in a deployment secret manager outside development. Development Compose credentials and services must not be exposed publicly.

## Local operation

1. `npm run backend:up` starts API on `127.0.0.1:4174` and private local dependencies. `npm run backend:dev` is the SQLite/Python fallback when Docker is unavailable.
2. `npm run start` builds the frontend and serves it at `127.0.0.1:4173` with same-origin proxying.
3. Mailpit at `127.0.0.1:8025` receives emails in Compose mode; direct development mode logs verification/reset codes in the backend terminal.
4. `npm run backend:down` stops containers without deleting persistent volumes. Stop the direct API with Ctrl+C in its terminal.
