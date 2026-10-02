[Back to README](../README.md) · [Architecture →](architecture.md)

# Локальный запуск сайта и backend

## Требования

- Docker Desktop с запущенным Docker Engine — сайт, FastAPI, PostgreSQL, Redis, MinIO, ClamAV и Mailpit.
- Node.js и npm — только для отдельной сборки и запуска frontend.
- Python 3.11+ — только для отдельного запуска backend с локальной SQLite-базой.
- Chromium нужен только для Playwright browser checks.

## Запустить всё одним Compose

Compose-файл расположен в корне репозитория и управляет сайтом, API и всеми зависимостями. Из корня проекта один раз скопируйте шаблон:

~~~powershell
Copy-Item .env.example .env
~~~

Проверьте `LUG_ADMIN_EMAIL` и задайте пароль администратора в `.env`. Шаблонные значения подходят только для локальной разработки. Затем выполните:

~~~powershell
docker compose up --build -d
~~~

Эта команда из корня собирает frontend из `Dockerfile`, API из `backend/Dockerfile`, применяет миграции и поднимает PostgreSQL, Redis, MinIO с созданием bucket, ClamAV и Mailpit. Сайт доступен на [http://127.0.0.1:4173/](http://127.0.0.1:4173/), API — на `http://127.0.0.1:4174/`, MinIO Console — на `http://127.0.0.1:9001/`, Mailpit — на `http://127.0.0.1:8025/`. Сайт проксирует `/api/*` и `/uploads/*` к API внутри Compose-сети, поэтому браузер использует same-origin cookies.

Полезные команды из корня:

~~~powershell
docker compose ps
docker compose logs -f web backend
docker compose down
~~~

`docker compose down` сохраняет volumes с базой и файлами. `docker compose down --volumes` удаляет их вместе с данными. Короткие npm-алиасы: `npm run docker:up` и `npm run docker:down`.

## Запуск без Docker

Если Docker Engine или загрузка образов недоступны, из корня скопируйте `backend/.env.example` в `backend/.env`, настройте dev-параметры и установите runtime-зависимости в каталоге `backend/`:

~~~powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e .
~~~

Затем из корня откройте два терминала. В первом запустите `npm run backend:dev`: команда применит миграции и поднимет FastAPI с SQLite, локальным хранением файлов и dev-отправкой писем в журнал процесса. Во втором выполните `npm run start`. Регистрация сразу открывает кабинет и не требует подтверждать email; код восстановления пароля будет напечатан в терминале backend. Данные хранятся в `backend/data/` и `backend/uploads/`.

## Локальный администратор

Локальные учётные данные для Compose хранятся в игнорируемом Git файле `.env` в корне. Он должен содержать:

~~~dotenv
LUG_ADMIN_EMAIL=admin@lug.local
LUG_ADMIN_PASSWORD=<длинный сложный пароль>
~~~

Скопируйте `.env.example` и задайте пароль до первого запуска. Контейнер создаёт учётную запись администратора, если её ещё нет. Не публикуйте `.env`.

## Команды

- `npm run build` — собрать публичную страницу и скопировать runtime ресурсы в `dist/`.
- `npm run start` — пересобрать сайт и открыть preview на порту 4173.
- `docker compose up --build -d` — собрать и запустить весь стек из корня.
- `docker compose down` — остановить Compose сервисы, сохранив volumes.
- `npm run docker:up` / `npm run docker:down` — короткие алиасы Compose-команд.
- `npm run backend:dev` — мигрировать локальную SQLite-базу и запустить backend без Docker.

Исходники frontend находятся в `src/`. Редактируйте их вместо `dist/`, который перезаписывает сборщик.

## Регистрация и восстановление доступа

Создайте команду или откройте ссылку приглашения капитана: после успешной регистрации кабинет доступен сразу, без подтверждения email. При восстановлении пароля одноразовый код появится в Mailpit при Compose запуске или в терминале backend в SQLite-режиме. Кабинет и админ-панель используют server-side сессию в HttpOnly cookie и CSRF cookie/header. Данные команд, статусы проверок и файлы сохраняет backend.

## Ручная проверка frontend

~~~powershell
npm test
npm run check:assets
~~~

Backend README содержит команды для его тестов, линтеров и миграций. Не запускайте их на продуктивной базе данных.

## См. также

- [Архитектура](architecture.md)
- [Конфигурация](configuration.md)
- [Backend operations runbook](../backend/docs/operations.md)
