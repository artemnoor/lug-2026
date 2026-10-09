# Развёртывание на существующей VM Yandex Cloud

## Текущий стенд

Сайт опубликован по адресу [https://111.88.145.41](https://111.88.145.41). Используется уже существующая VM `lug-2026-app` (2 vCPU на 20%, 3 ГБ RAM, диск 40 ГБ) и Compose-проект `lug` в `/opt/lug-next`. Новые VM, балансировщики, управляемые БД и дополнительные контейнеры не создавались.

Nginx на VM завершает HTTPS и проксирует запросы в Node web gateway на `127.0.0.1:4173`; gateway передаёт `/api/*` и `/uploads/*` существующему FastAPI. PostgreSQL, Redis, ClamAV и worker остались на прежних контейнерах. Обновлена только публичная статика из `dist/`; миграции БД и тома с регистрациями и файлами не затрагивались.

VM использует временный самоподписанный сертификат для IP. Поэтому браузер может предупредить о сертификате; для доверенного HTTPS нужен домен и сертификат на него.

## Публикация следующих версий

1. Соберите статику командой `npm run build`.
2. Загрузите `dist/` в новую версионную папку на VM. В корне этой папки разместите `index.html` и `register.html` под `pages/`, а `account/`, `assets/`, `scripts/` и `styles/` оставьте рядом. Добавьте один query-параметр версии к локальным ссылкам на CSS, JS и изображения, чтобы браузер не использовал кэш прошлого релиза.
3. Переключите `/opt/lug/site-current` на новую папку.
4. Пересоздайте только web-контейнер, явно указав существующий Compose project:

   ```bash
   cd /opt/lug-next
   sudo docker compose -p lug --env-file .env.production -f docker-compose.split.yml up -d --no-deps --force-recreate --no-build web
   ```

Если меняется правило выдачи статических каталогов в `apps/web/src/static.js`, сначала пересоберите только web-образ командой `sudo docker compose -p lug --env-file .env.production -f docker-compose.split.yml build web`.

Не запускайте отдельный Compose-проект для этой VM и не используйте `down -v`: это создаст дублирующие ресурсы либо удалит тома данных. Текущий gateway разрешает `account/`, `scripts/` и `styles/` в дополнение к уже существующим публичным каталогам.

## Казахстанский стенд

Текущая версия также развёрнута в каталоге `ao7h9688rlvf4pov7kbc` на отдельной VM `lug-2026-kz` в зоне `kz1-a`. VM `andromeda-max-kz` в этом каталоге принадлежит другому приложению и не менялась.

Публичный адрес: [https://185-32-85-206.sslip.io](https://185-32-85-206.sslip.io). Caddy получает и автоматически обновляет TLS-сертификат. Адрес использует DNS `sslip.io` и содержит текущий публичный IP VM.

ВМ: 2 vCPU с базовой производительностью 20%, 4 ГБ RAM и сетевой SSD 40 ГБ. Порты веба 80/443 публикует только Caddy. Web gateway и API привязаны к `127.0.0.1`; PostgreSQL, Redis, MinIO, ClamAV и Mailpit доступны только внутри Compose-сети.

Исходники находятся в `/opt/lug-2026`; Dockerfile пересобирает frontend из `src/`. Для обновления передайте актуальные исходники на VM, затем выполните:

```bash
cd /opt/lug-2026
sudo docker compose -p lug-kz --env-file .env \
  -f docker-compose.yml \
  -f deploy/yandex/docker-compose.kazakhstan.yml \
  up --build -d
```

`.env` на VM содержит `LUG_ADMIN_EMAIL`, `LUG_ADMIN_PASSWORD`, `LUG_SECURE_COOKIES=true` и `LUG_DOMAIN=185-32-85-206.sslip.io`. Не заменяйте `.env` файлом из Git и не удаляйте volumes: в PostgreSQL и MinIO находятся данные стенда.

Оценка для непрерывной работы на 30 дней — около 13 400 ₸ за вычислительные ресурсы и активный публичный IP, плюс диск 40 ГБ и исходящий трафик сверх включённого объёма. Yandex Cloud тарифицирует VM посекундно, диск и сеть считаются отдельно: [тарифы Compute Cloud Казахстан](https://yandex.cloud/ru-kz/docs/compute/pricing), [тарифы VPC Казахстан](https://yandex.cloud/ru-kz/docs/vpc/pricing).

## Стоимость

Для круглосуточной работы вычислительные ресурсы этой VM стоят ориентировочно 1 462 ₽ за 30 дней по текущему тарифу Yandex Cloud (2 × 20% vCPU и 3 ГБ RAM). Диск и активный публичный IP оплачиваются отдельно; первые 100 ГБ исходящего трафика в месяц не тарифицируются. Размер счёта зависит от региона, операционной системы и условий аккаунта. [Тарифы Compute Cloud](https://yandex.cloud/ru/docs/compute/pricing), [тарифы VPC](https://yandex.cloud/ru/docs/vpc/pricing).
