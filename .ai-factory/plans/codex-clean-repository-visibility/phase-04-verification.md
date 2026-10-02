# Фаза 4: документация и итоговая проверка

Plan: [index.md](index.md)
Tasks: 6–7
Depends on: Phase 3 / Task 5

## Цель
Обновить инструкции после переноса ресурсов и добавления Playwright, затем подтвердить видимость секций, поведение перехода, доступность контента без CDN-скриптов и чистоту корня.

## Текущие свидетельства в коде

| Путь | Символы / строки | Почему важно |
|------|------------------|--------------|
| README.md | описание проекта и локального запуска | Ранее тестового package.json не было; после Task 1 README должен содержать актуальные команды |
| docs/getting-started.md | требования и запуск проекта | Нужно описать Node/npm, установку зависимостей, запуск статического сайта и браузера |
| docs/architecture.md | точки входа и локальные ресурсы | Сейчас перечисляет текущую организацию статического приложения |
| docs/configuration.md | параметры AI Factory и GitHub MCP | Обновлять только если проверка выявит изменившиеся команды/пути; секреты в документацию не копировать |
| .ai-factory/DESCRIPTION.md | стек и корневое размещение изображений/шрифтов | Устареет после переезда в assets/ и появления test-only Node tooling |
| AGENTS.md | карта проекта и дерево каталогов | Нужно показать assets/, tests/, scripts/ и удалённые generated directories |
| .ai-factory/ARCHITECTURE.md | текущая frontend-структура и целевая серверная layered architecture | Документ описывает `src/` и сохраняет будущие backend-слои |

## Файлы для изменения

| Путь | Действие | Ответственность |
|------|----------|----------------|
| README.md | изменить | Краткий overview, установка, локальный просмотр и проверки |
| docs/getting-started.md | изменить | npm ci, установка Chromium и запуск localhost |
| docs/architecture.md | изменить | Новые каталоги assets/scripts/tests и fail-open reveal flow |
| docs/configuration.md | проверить/изменить только при необходимости | Сохранить актуальность уже существующих настроек |
| .ai-factory/DESCRIPTION.md | изменить | Уточнить, что Node/Playwright — только проверочный инструментарий, а assets в assets/ |
| AGENTS.md | изменить | Актуальное дерево проекта, точки входа и правила хранения screenshot outputs |
| .ai-factory/ARCHITECTURE.md | обновить frontend-раздел | Сохранить целевые backend-слои без реализации backend |

<a id="task-6"></a>
## Task 6: Обновить проектную документацию

### Намерение
После реализации инструкции не должны ссылаться на удалённые корневые снимки/фрагменты и не должны утверждать, что изображения лежат в корне. Docs=yes означает обязательный документальный checkpoint через $aif-docs.

### Последовательность реализации
1. После Task 5 запустить $aif-docs, используя фактические package.json, npm scripts, каталог assets/ и Playwright tests как источники истины.
2. В README.md оставить краткий проектный обзор и команды: npm ci, npx playwright install chromium, npm run build, npm run start, npm test, npm run check:assets. Указать URL localhost:4173.
3. В docs/getting-started.md описать Node/npm, установку Chromium, раскрытие HTML-включений в `dist/` и команды запуска/проверки. Уточнить, что backend не нужен, а сборщик статический и без внешних зависимостей.
4. В docs/architecture.md описать `index.html` → `src/components/` и `src/sections/` → `dist/`, затем CDN bootstrap → `scripts/app.js` → fail-open reveal fallback; указать `src/assets/` и каталоги скриптов.
5. В docs/configuration.md сохранить сведения о .ai-factory/config.yaml и .codex/config.toml; не вставлять значения токенов, персональные пути, browser profile или секреты.
6. Обновить .ai-factory/DESCRIPTION.md: runtime остаётся статическим; Node раскрывает шаблоны и копирует страницу; сторонний bundler и backend отсутствуют.
7. Обновить AGENTS.md: зафиксировать структуру `src/`, `scripts/`, `dist/`, `tests/` и report locations; обозначить generated paths из .gitignore.
8. Сверить команды с package.json и пути с реальной структурой. Обновить текущий frontend-раздел `.ai-factory/ARCHITECTURE.md`, сохранив описание будущих серверных слоёв.

### Интерфейсы и контракты
- Источник команд — package.json; источник путей — итоговые директории репозитория.
- Документация на русском, технические имена/команды и URL оставляются как в коде.
- README является короткой точкой входа; подробные инструкции остаются в docs/.
- $aif-docs обязателен при Docs: yes и обновляет только документы, относящиеся к текущему проекту.

### Ошибки и логирование
- Если $aif-docs или ручная сверка обнаруживает документацию, противоречащую коду, фактический package.json/исходники считаются реализацией, а текст обновляется.
- Не копировать в документацию токены, локальные абсолютные пути пользователя, screenshot names, персональные browser state или выводы с содержимым форм.
- В verbose режиме перечислять изменённые документы и основания; не создавать дополнительный лог-файл.

### Тесты
- Сопоставить команды из README и docs/getting-started.md с package.json без запуска внешних сервисов.
- Проверить относительные Markdown-ссылки на файлы и секции; ссылка на .ai-factory/ARCHITECTURE.md может оставаться только как target backend-контекст.

### Критерии приёмки
- README и docs описывают команду сборки, актуальные `src/` пути и полный browser-test setup.
- AGENTS.md не перечисляет удалённые screenshots как файлы проекта и указывает безопасное место для новых отчётов.
- Документы не утверждают, что backend уже реализован.

### Проверка
- `npm run check:assets`
- Проверить ссылки и команды в README.md, docs/ и AGENTS.md по итоговой структуре.
- Ожидаемый результат: ссылки на удалённые артефакты и старую root media-структуру отсутствуют.

<a id="task-7"></a>
## Task 7: Выполнить итоговую проверку сайта и чистоты репозитория

### Намерение
Завершить работу доказательствами в трёх направлениях: контент виден, ресурсы целы, корень очищен. Старые screenshots не используются как доказательство, потому что они были сняты до текущего исправления.

### Последовательность реализации
1. Чисто установить зависимости командой npm ci. Установить Chromium командой npx playwright install chromium; получаемые бинарники должны оставаться вне исходного каталога или в node_modules cache, не в корне проекта.
2. Запустить npm run check:assets -- --strict-unused; устранить любой отсутствующий путь или неиспользуемый root media до UI проверки.
3. Запустить node --check для `src/scripts/app.js`, `src/scripts/hero-prize-transition.js`, `src/scripts/normal-scroll.js`, `scripts/build-site.mjs`, `scripts/serve-site.mjs` и `scripts/check-local-assets.mjs`.
4. Запустить npm test. Проверить, что offline-script сценарий не выдаёт pageerror локального кода, показывает заголовки всех секций и не оставляет скрытых split spans.
5. Провести ручной online-browser smoke test на localhost:4173 при доступных CDN-стилях и скриптах. Проверить старт, scroll progress=0, середину и конец сцены; полный путь от #hero до #cta; возвращение наверх; повторную загрузку.
6. Проверить размеры 390×844, 768×1024 и 1440×900. Для каждой ширины убедиться в видимости h1 поверх campus photo, отсутствии горизонтального overflow и доступности всех девяти section headings после прокрутки.
7. Проверить prefers-reduced-motion и имитацию блокировки удалённых script URL. В обоих случаях ни один текстовый блок не исчезает; при script block встроенный fallback активирует состояние fallback.
8. Проверить локальные изображения по network requests и браузерным broken-image checks; картинки и шрифты собираются из `src/assets/` в `dist/assets/`.
9. Повторно выполнить strict asset audit и git status --short. Проверить, что Playwright outputs находятся только в игнорируемых каталогах, а старые root screenshot/dump/browser folders отсутствуют.
10. Не удалять и не пушить пользовательские изменения. Не выполнять push/PR/merge: remote origin отсутствует, main не существует; статус repository integration записан в index.md.

### Интерфейсы и контракты
- Проверочная последовательность: npm ci → npx playwright install chromium → npm run check:assets -- --strict-unused → node --check для runtime/dev JS → npm test → ручной браузерный smoke test.
- Контентная матрица в тесте включает #hero, #prizes, #tracks, #stages, #portfolio, #documents, #history, #faq и #cta.
- Онлайн-проверка выявляет ошибки самих CDN/library scripts; blocked-script тест намеренно проверяет независимый fail-open режим. Не считать DNS/CDN error при offline-сценарии дефектом приложения, если content assertions проходят.
- Скриншоты и traces для отчёта сохранять под test-results/, не в корень и не в assets/.

### Ошибки и логирование
- Любой pageerror локального JS, missing local asset, пустой heading, нулевая opacity текста, перекрытие hero title и горизонтальный overflow — блокирует завершение.
- Ожидаемые ошибки запросов к заблокированным CDN исключаются только в offline-script тесте и описываются в отчёте; online smoke test не фильтрует ошибки CDN.
- В verbose отчёте приложить viewport, section ID, progress, ancestor z-index, состояние reveal и пути missing assets. Не включать значения полей формы/секреты.

### Тесты
- `npm run check:assets -- --strict-unused`
- `node --check app.js`
- `node --check hero-prize-transition.js`
- `node --check normal-scroll.js`
- `node --check scripts/serve-site.mjs`
- `node --check scripts/check-local-assets.mjs`
- `npm test`
- Ручная проверка desktop/tablet/mobile и transition states из списка выше.

### Критерии приёмки
- Все автоматизированные проверки завершаются кодом 0.
- Все девять секций видимы; hero title в начальном состоянии выше фотографии.
- Продолжение страницы после prizes доступно, CTA и form/FAQ не обрезаны.
- Режим без удалённых scripts и reduced-motion не превращают страницу в пустую.
- Корень содержит только активные исходники, конфигурацию и папки assets/docs/scripts/tests; generated artifacts скрыты правилами .gitignore.
- Пользовательские данные, сайт-контент и production-ассеты не удалены.

### Проверка
- Выполнить команды из списка тестов строго по порядку.
- Ожидаемый результат: строгий asset audit и весь Playwright suite проходят; при online CDN отказе зафиксирована конкретная внешняя зависимость, а offline-script/readability guarantees сохраняются.

## Риски фазы и меры
- Риск: CDN недоступен в online smoke test, что смешивает сбой сети со сбоем страницы. Мера: держать отдельный тест с заблокированными только remote scripts, а online smoke повторять при стабильном доступе.
- Риск: старый output screenshot принимают за итог. Мера: итоговые доказательства создавать заново в test-results/ и повторно снять все целевые размеры.
- Риск: текущий Git не имеет main/origin. Мера: завершить локальную проверку на рабочей ветке и не заявлять, что создан PR или выполнено слияние.

## Критерии завершения фазы
- Task 6 синхронизирует документы с фактическими изменениями.
- Task 7 подтверждает UI, assets, тесты и отсутствие артефактов в корне.
- Обновлены только checkbox-строки Tasks 1–7 в index.md; phase files остаются без progress checkboxes.
