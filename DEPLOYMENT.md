# Production deployment

## Короткий ответ

Для локальной разработки Nginx не нужен: `server.js` уже запускает FastAPI и
Node web gateway, который отдаёт статику и проксирует `/api/*`, `/uploads/*`,
`/readyz` и `/metrics`.

Для публичного production Nginx рекомендуется и практически нужен как внешний
edge-слой: он принимает TLS, ограничивает размер тела и соединения, защищает
медленные upstream-подключения и скрывает внутренние порты. Nginx не заменяет
CDN/WAF и не должен проксировать запросы напрямую в FastAPI.

```text
Internet
   │
   ▼
CDN/WAF (рекомендуется для публичного запуска)
   │ HTTPS
   ▼
Nginx :443          TLS, edge limits, health/metrics ACL
   │ 127.0.0.1:4173
   ▼
Node web gateway    CSRF-cookie, static allowlist, reverse proxy
   │ 127.0.0.1:4174
   ▼
FastAPI             auth, RBAC, domain, uploads, notifications
   ├── PostgreSQL   production persistence
   ├── Redis        shared rate limiting for multiple instances
   ├── S3 storage   private files and signed URLs
   └── ClamAV       malware scanning before publication
```

## Что обязательно

| Компонент | Зачем | Статус в проекте |
| --- | --- | --- |
| Node web gateway | Same-origin UI/API, CSRF-cookie, private upload proxy | Уже есть |
| FastAPI | Бизнес-логика, auth, RBAC, API | Уже есть |
| Nginx или managed load balancer | TLS, edge limits, скрытие origin | Нужен только перед public production |
| TLS certificate | HTTPS и secure cookies | Настраивается на edge |
| PostgreSQL | Нормализованное общее хранилище вместо JSON | Адаптер и bootstrap-миграция есть, включается явно |
| Redis | Общий rate limiter при нескольких API-инстансах | Адаптер есть, задаётся `REDIS_URL` |
| Private object storage | Файлы вне локального диска и публичной статики | S3-compatible adapter, credentials и bucket policy |
| AV scanner | Проверка пользовательских файлов | Hook ClamAV есть; production без scanner fail-closed |
| SMTP provider | Доставка кодов подтверждения email | Требуется production-интеграция; локально доступен log mode |
| Process manager | Restart, logs, graceful stop | Выбрать systemd или Docker Compose |

## Что рекомендуется дополнительно

- CDN/WAF перед Nginx для DDoS, bot-фильтрации и глобального rate limiting.
- Prometheus + Grafana для `/metrics`, Loki/ELK или managed logging для JSON-логов.
- Автоматические PostgreSQL backups, restore-проверки и lifecycle policy для S3.
- OTLP collector для traces; gateway прокидывает W3C `traceparent`, API экспортирует spans при заданном `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Secret manager для `LUG_ADMIN_PASSWORD`, `LUG_OPERATIONS_TOKEN`, database URL и
  scanner credentials, SMTP password и `LUG_EMAIL_VERIFICATION_SECRET`; секреты не должны попадать в `.env`, архивы или логи.
- MFA/SSO для administrator accounts — отдельный auth-контур, которого сейчас
  нет в приложении.

## Минимальный single-host production

Для небольшого конкурса достаточно одной Linux VM:

1. Nginx принимает `80/443`; API и Node слушают только `127.0.0.1`.
2. systemd или Docker Compose управляет Node gateway и FastAPI.
3. PostgreSQL и Redis работают как отдельные сервисы с backup policy.
4. Задать `LUG_FILE_STORAGE_PROVIDER=s3`, private bucket, `LUG_S3_BUCKET`, при необходимости endpoint/credentials и lifecycle policy; scanner обязателен. API выдаёт только короткие presigned GET URLs после проверки прав.
5. `/metrics` и `/readyz` разрешены только monitoring network, `/healthz` можно
   оставить публичным как минимальный liveness endpoint.
6. Firewall закрывает прямой внешний доступ к `4173`, `4174`, PostgreSQL и Redis.

Шаблон Nginx находится в [`deploy/nginx/lug.conf.example`](deploy/nginx/lug.conf.example).
Он проксирует весь application traffic в Node gateway, чтобы не обходить
CSRF и ограничения web gateway.

## Текущий экономичный deployment в Yandex Cloud

Для текущего запуска создана одна VM в `ru-central1-b`:

- `2 vCPU / 4 GiB RAM`, 40 GiB network SSD;
- Docker Compose поднимает Node/FastAPI, PostgreSQL 16, Redis 7 и ClamAV;
- приватный Yandex Object Storage bucket используется только для файлов;
- наружу открыт только HTTP `:80`, SSH ограничен текущим IP администратора;
- приложение доступно на `http://51.250.102.106`.

Это экономичный staging-профиль: PostgreSQL, Redis и ClamAV находятся на той же
VM, поэтому они не являются отдельными managed-внешними сервисами. Внешним
относительно VM остаётся только приватное объектное хранилище. SMTP пока не
подключён, поэтому email-коды пишутся в staging-лог; перед реальным production
нужно задать SMTP, домен и TLS/WAF.

Запуск на VM:

```bash
cd /opt/lug
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
```

Исходный `lug.json` импортируется одноразовой командой
`scripts/import-json-postgres.py` в нормализованные таблицы PostgreSQL. После
импорта legacy-таблица `lug_state` удаляется. Образы и volumes не следует
удалять без отдельной процедуры backup/restore.

Для перехода от staging к production необходимо добавить домен, TLS edge
(Nginx/Caddy или managed load balancer), WAF/CDN, SMTP и резервное копирование
PostgreSQL. При росте нагрузки VM можно разделить на app-ноды, managed
PostgreSQL и Redis; текущий код уже использует общий Postgres/Redis и private
object storage, поэтому локальный JSON-store не будет узким местом.

## Масштабирование

При нескольких экземплярах Node/API нужны общий PostgreSQL, Redis и object
storage. PostgreSQL-адаптер хранит сущности отдельными строками и не использует
глобальный process-local mutation lock; pool настраивается через
`LUG_DATABASE_POOL_MIN_SIZE`/`LUG_DATABASE_POOL_MAX_SIZE`. Локальный JSON-store и
локальная папка `uploads/` подходят только для одного development/single-host
экземпляра. Web gateway можно масштабировать отдельно, но
`LUG_TRUST_PROXY=true` допустим только вместе с точным списком
`LUG_TRUSTED_PROXY_IPS`.

## Текущее состояние среды разработки

На проверенной машине Nginx не установлен. Docker CLI и Compose установлены,
но Docker daemon не запущен; порт `80` занят системным процессом. Поэтому
локальный запуск остаётся на `npm start`, а production edge следует разворачивать
на Linux VM, managed load balancer или после отдельной настройки Windows-сервиса.

## Перед публикацией

- [ ] DNS указывает на CDN/WAF или Nginx.
- [ ] TLS включён; secure cookies проверены.
- [ ] origin закрыт firewall-правилами.
- [ ] `LUG_ALLOWED_HOSTS` содержит только реальные hostnames.
- [ ] `LUG_OPERATIONS_TOKEN` задан; `/metrics` и `/readyz` закрыты ACL.
- [ ] `LUG_TRUST_PROXY=true` включён только при заданном списке trusted proxy IP.
- [ ] `LUG_DATABASE_PROVIDER=postgres`, `LUG_DATABASE_URL` и `REDIS_URL` настроены.
- [ ] `LUG_UPLOAD_SCAN_COMMAND` настроен, scanner доступен, upload quarantine проверен.
- [ ] `LUG_FILE_STORAGE_PROVIDER=s3`, bucket private, S3 credentials/IAM policy и `LUG_S3_SIGNED_URL_TTL` проверены.
- [ ] `LUG_EMAIL_MODE=smtp`, SMTP credentials и `LUG_SMTP_FROM` настроены; письмо с кодом проверено.
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT` настроен, trace виден в collector/backend.
- [ ] `LUG_EMAIL_VERIFICATION_SECRET` задан отдельным случайным секретом; коды не пишутся в production-лог.
- [ ] backup/restore и ротация секретов проверены вручную.
- [ ] Smoke, dependency audit и внешний security scan пройдены после deployment.
