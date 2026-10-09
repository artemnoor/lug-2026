# AGENTS.md

> Обновляйте эту карту, если структура проекта заметно изменится.

## Обзор

Сайт конкурса «Лучшая учебная группа» МГТУ им. Н. Э. Баумана с публичными разделами, личным кабинетом участников и админ-панелью организаторов. Frontend — статический HTML/CSS/браузерный JavaScript. Backend — FastAPI modular monolith в каталоге `backend/`, в том же Git-репозитории. Полный локальный стек поднимается единым корневым `docker-compose.yml`; проектная документация находится в `docs/` и backend документации.

## Технологии

- HTML, CSS, vanilla JavaScript; без frontend framework и runtime JS-библиотек.
- Node.js раскрывает HTML-включения, копирует frontend в `dist/` и в режиме preview проксирует `/api/*` и `/uploads/*`.
- `backend/`: Python 3.11+, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic.
- Данные: PostgreSQL; локальная среда также содержит Redis, MinIO, ClamAV и Mailpit через Docker Compose.
- Backend применяет cookie-сессии и CSRF double-submit; права участника/администратора проверяются на сервере.
- Playwright используется для frontend browser regressions; backend имеет собственные pytest/ruff/mypy проверки.

## Структура проекта

~~~text
.
├── index.html                         # Публичная страница и окно авторизации
├── src/
│   ├── register.html                  # Прямой адрес регистрации → окно на главной
│   ├── components/                    # Оболочка, шапка, мобильное меню, окно авторизации
│   ├── sections/                      # Публичные секции и регистрационные переходы
│   ├── account/                       # Кабинет участника, админка, CSS, шрифты и логотипы
│   ├── styles/site.css                # Стили публичного сайта
│   ├── styles/auth-dialog.css         # Стили модального входа и регистрации
│   ├── scripts/features/account/      # API, авторизация, кабинет, админка и модули
│   └── assets/                        # Шрифты, картинки и SVG
├── scripts/
│   ├── build-site.mjs                 # Собирает статический frontend в dist/
│   ├── serve-site.mjs                 # Preview server + локальный backend proxy
│   └── start-backend.ps1              # Миграции и локальный FastAPI без Docker
├── Dockerfile                         # Сборка frontend контейнера
├── docker-compose.yml                 # Единый запуск сайта, API и инфраструктуры
├── .env.example                       # Шаблон параметров локального Compose
├── deploy/yandex/                     # Публикация статики на существующую VM
├── backend/                           # FastAPI backend, часть этого репозитория
│   ├── app/modules/                   # Вертикальные auth/team/media/admin модули
│   ├── alembic/                       # Миграции схемы
│   └── Dockerfile                     # Контейнер FastAPI API
├── docs/                              # Запуск, архитектура и конфигурация
├── tests/e2e/                         # Browser regressions публичного сайта
├── dist/                              # Сгенерированный frontend; не редактировать
~~~

## Основные точки входа

| Путь | Назначение |
|------|------------|
| `index.html` | Порядок публичных секций и подключение окна авторизации |
| `src/register.html` | Прямой переход к той же форме регистрации на главной странице |
| `src/components/auth-dialog.html` | Сценарии регистрации, входа и восстановления доступа |
| `src/account/cabinet.html` | Страница личного кабинета участника |
| `src/account/admin.html` | Страница панели оргкомитета |
| `src/scripts/features/account/store.js` | Same-origin API, CSRF, загрузки и нормализация ответов backend |
| `src/scripts/features/account/` | Логика авторизации, кабинета и админ-панели |
| `src/account/css/` | Изолированные стили кабинета и админки с темой сайта |
| `src/sections/registration.html` | Переходы к регистрации команды, вступлению и входу |
| `scripts/build-site.mjs` | HTML includes и копирование frontend runtime |
| `scripts/serve-site.mjs` | Локальный preview на 4173 и proxy к API на 4174 |
| `scripts/start-backend.ps1` | Запуск API и миграций на локальной SQLite базе |
| `backend/app/main.py` | Backend composition root и API роутеры |
| `backend/app/modules/` | Auth, users, teams, media, portfolio, video, notifications, content, admin |
| `docker-compose.yml` | Сайт, API, PostgreSQL, Redis, MinIO, ClamAV и Mailpit |
| `docs/getting-started.md` | Полный локальный запуск обоих приложений |

## Запуск

Для полного стека скопируйте `.env.example` в `.env`, задайте пароль администратора и выполните `docker compose up --build -d` в корне. Сайт откроется на порту 4173, API — 4174, Mailpit — 8025. MinIO не публикует порты на хост и доступен API только во внутренней сети Compose. `docker compose down` останавливает контейнеры, сохраняя volumes. При недоступном Docker установите Python-зависимости в `backend/.venv`, затем запустите `npm run backend:dev` вместе с `npm run start`; данные хранятся в SQLite.

Frontend редактируйте в `src/`, а backend — внутри `backend/` по его `ARCHITECTURE.md`. Не добавляйте ключи и пароли в HTML, JavaScript или Git. Не выполняйте push, PR или merge без настроенного remote и явной задачи.
