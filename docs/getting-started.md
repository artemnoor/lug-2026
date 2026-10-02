[Back to README](../README.md) · [Architecture →](architecture.md)

# Локальный запуск сайта и backend

## Требования

- Node.js и npm — сборка и локальный frontend сервер.
- Docker Desktop с работающим Docker Engine — полный стек FastAPI, PostgreSQL, Redis, MinIO, ClamAV и Mailpit.
- Python 3.11+ — альтернативный запуск FastAPI с локальной SQLite-базой.
- Chromium нужен только для Playwright browser checks.

## Поднять полный стек

Из корня проекта:

~~~powershell
npm run backend:up
~~~

Команда собирает backend Docker image, выполняет Alembic migrations и запускает сервисы в фоне. API слушает только `127.0.0.1:4174`; загрузки проходят через локальный MinIO и ClamAV. Mailpit принимает письма регистрации и восстановления пароля на `http://127.0.0.1:8025/`.

Затем во втором терминале запустите сайт:

~~~powershell
npm run start
~~~

Сайт доступен на [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Сервер preview проксирует запросы `/api/*` и `/uploads/*` к backend и передаёт сессионные cookie браузеру. Для полной остановки нажмите Ctrl+C в терминале сайта и выполните `npm run backend:down`.

## Запуск без Docker

Если Docker Engine или загрузка образов недоступны, из каталога `backend/` создайте окружение и установите runtime-зависимости:

~~~powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e .
~~~

Затем из корня откройте два терминала. В первом запустите `npm run backend:dev`: команда применит миграции и поднимет FastAPI с SQLite, локальным хранением файлов и dev-отправкой писем в журнал процесса. Во втором выполните `npm run start`. Регистрация сразу открывает кабинет и не требует подтверждать email; код восстановления пароля будет напечатан в терминале backend. Данные хранятся в `backend/data/` и `backend/uploads/`.

## Локальный администратор

Локальные учётные данные хранятся в игнорируемом Git файле `backend/.env`. Он должен содержать:

~~~dotenv
LUG_ADMIN_EMAIL=admin@lug.local
LUG_ADMIN_PASSWORD=<длинный сложный пароль>
~~~

Если файл отсутствует, скопируйте `backend/.env.example` и задайте новый пароль до первого запуска. Контейнер создаёт учётную запись администратора при старте, когда такой записи ещё нет. Пароль из `.env` не публикуйте и не отправляйте в репозиторий.

## Команды

- `npm run build` — собрать публичную страницу и скопировать runtime ресурсы в `dist/`.
- `npm run start` — пересобрать сайт и открыть preview на порту 4173.
- `npm run backend:up` — собрать/запустить Docker Compose backend.
- `npm run backend:down` — остановить Compose сервисы; данные в именованных volumes сохраняются.
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
