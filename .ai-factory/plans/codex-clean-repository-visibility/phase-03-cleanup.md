# Фаза 3: очистка и структура ресурсов

Plan: [index.md](index.md)
Tasks: 5
Depends on: Phase 1 / Task 2; Phase 2 / Tasks 3–4

## Цель
Убрать из корня тестовые скриншоты, дампы, старые фрагменты страницы, случайный browser/cache output и неиспользуемые медиа, сохранив все ресурсы текущей страницы и AI/Codex-документы.

## Текущие свидетельства в коде

| Путь | Символы / строки | Почему важно |
|------|------------------|--------------|
| index.html | локальные src/href/url() около строк 234–255, 1756–1778, 2932–3423 | Отсюда получен набор из 17 используемых локальных изображений, SVG и шрифтов |
| корень проекта | 155 PNG; 144 root-кандидата media/font в текущем одноразовом аудите; 0 tracked-файлов по git ls-files | Большинство PNG — сохранённые проверки; изменения нельзя выбирать по Git tracking, нужен reference audit |
| .browser-* | локальные Chromium профили нескольких предыдущих проверок | Не являются runtime-файлами сайта |
| .playwright-cli/, output/, graphify-out/ | логи/снимки, PNG сравнений и cache | Генерируемые результаты инструментов |
| index.original.html; orig_between_hero_and_modal.html | старое английское содержание Era Residence | Эти файлы не содержат секции конкурса и не используются текущей страницей |
| reconstruct_apply_sections.py | жёстко заданный путь к личной папке .gemini | Одноразовый скрипт восстановления; его входной файл отсутствует в проекте |
| slater.js | 113-байтовый динамический импорт assets.slater.app | Не подключён текущей index.html и не является частью локальных runtime-файлов |
| .ai-factory/, docs/, AGENTS.md, .codex/config.toml | проектный/агентский контекст | Сохранить; эти документы и конфигурация не являются screenshot мусором |

## Файлы для изменения

| Путь | Действие | Ответственность |
|------|----------|----------------|
| src/assets/images/ | создать | Хранить используемые растровые изображения и SVG в исходниках frontend |
| src/assets/fonts/ | создать | Хранить два используемых MegaSans TTF в исходниках frontend |
| src/ и index.html | изменить | Разделить страницу на компоненты/секции и подключить их шаблонными includes после аудита |
| .gitignore | создать или изменить | Игнорировать node_modules, тестовые отчёты, browser profiles и generated output |
| корневые PNG/JPG/TXT/HTML/PY/JS и output/cache каталоги | удалить по заданному списку/правилу | Удалить только временные outputs и медиа без runtime/docs-ссылок |
| README.md, docs/, AGENTS.md, .ai-factory/DESCRIPTION.md | обновить в Task 6 | Отразить assets/, запуск тестов и очищенную структуру |

<a id="task-5"></a>
## Task 5: Перенести используемые ресурсы и удалить подтверждённый мусор

### Намерение
Разделить настоящие runtime-assets и результаты прошлых проверок, чтобы корень проекта перестал смешивать исходники страницы со 140+ снимками и профилями браузера. Ни один ресурс не удаляется до проверки ссылок и зелёного результата браузерных тестов.

### Последовательность реализации
1. До любых Move/Delete выполнить `npm run check:assets -- --report-unused` и сохранить список кандидатов в test-results/cleanup-candidates.txt. Просмотреть каждую найденную ссылку в index.html, app.js, normal-scroll.js, hero-prize-transition.js, README.md и docs/.
2. Создать assets/images/ и assets/fonts/. Переместить ровно следующие используемые ресурсы:
   - В assets/fonts/: MegaSans-Regular-43815a4d.508b3b.ttf и MegaSans-Bold-4898fab3.7acea0.ttf.
   - В assets/images/: bmstu_emblem_white.png, campus.jpg, grand-prize-trip.png, logo-bmstu-partner.png, logo-moscow-region.png, logo-youth-policy.png, lug_white.svg, stage-final.png, stage-offline.png, stage-online.png, stage-registration.png, studsovet_white.png, track-first-year.png, track-senior-years.png, ump_white.png.
3. Обновить все 17 CSS url(), img src и runtime references после переноса. В собранном HTML использовать `./assets/images/…`, в `src/styles/site.css` — `../assets/fonts/…`. Текст, названия файлов и alt не менять.
4. Немедленно выполнить `npm run check:assets` и `npm test` после переноса. До удаления кандидатов обе команды должны проходить; при missing path остановиться и вернуть файл/ссылку, не подменять её случайной картинкой.
5. Удалить все остальные файлы медиа корня с расширениями png/jpg/jpeg/svg/ttf/woff/woff2, если reference audit не находит их в источниках текущего сайта и документации. В этом состоянии отчёт показывает 142 неиспользуемых PNG и 2 неиспользуемых JPG-кандидата; использовать фактический свежий отчёт, а не это число как постоянную фикстуру.
6. Удалить подтверждённые исторические файлы корня: index.original.html, orig_between_hero_and_modal.html, reconstruct_apply_sections.py и slater.js. Удалить диагностические текстовые дампы arch_code.txt, hero_to_main_found.txt, hero_to_main_orig.txt, step_10_dump.txt, step_345_full_output.txt, step_4_dump.txt и steps_340_365.txt.
7. Удалить корневые screenshot-файлы, найденные инвентаризацией и не связанные с runtime/docs. Не удалять README.md, AGENTS.md, страницу/скрипты, локальные ресурсы до переноса, .ai-factory/, docs/ или .codex/config.toml.
8. Удалить только текущие generated directories: root .browser-* профили, .playwright-cli/, graphify-out/, output/ и node_modules/test result directories, если они уже появились. Не трогать .git/, .ai-factory/ и .codex/.
9. Создать/обновить .gitignore точными правилами для /node_modules/, /test-results/, /playwright-report/, /.playwright-cli/, /.browser-*/, /graphify-out/ и /output/. Не добавлять wildcard *.png или общие правила для assets/; будущие скриншоты записывать в test-results/ или output/.
10. После очистки выполнить strict asset audit и пройти полный Playwright suite. Если в корне остался ресурс, которого нет в runtime/docs-ссылках и он не в allowlist исходников, перенести его только если свежая проверка доказывает использование; иначе удалить как unused.

### Интерфейсы и контракты
- Источник списка runtime-assets — результаты scripts/check-local-assets.mjs плюс cross-check поиска по локальному HTML/CSS/JS и Markdown. Сканер не может автоматически удалять.
- Все 17 перечисленных файлов лежат в `src/assets/`; сборка копирует их в `dist/assets/`. alt и семантика изображения остаются прежними.
- Неиспользуемые медиа разрешено удалить, потому что задача явно требует очистки, но только если отсутствуют пути к ним в рабочих исходниках и документации. Не удалять медиа по имени/дате без аудита.
- В корне остаются шаблон страницы, сборочные команды, package.json/lock, проектные инструкции и конфигурация; редактируемый frontend и ресурсы лежат в `src/`.
- .gitignore исключает только явно generated output. Не игнорировать assets, HTML, JS, документацию или все изображения.

### Ошибки и логирование
- Перед удалением сравнить отчёт missing/unreferenced; при расхождении путей остановить удаление и исправить URL.
- При move failure оставить исходник на месте, сообщить точный путь и не создавать пустую копию назначения.
- Verbose журналировать каждый перемещённый/удалённый путь только в test-results/cleanup-candidates.txt или выводе команды; не создавать постоянный cleanup log в корне.
- Если имя ресурса есть в тексте Markdown как ссылка, считать его используемым и сохранить/обновить ссылку.

### Тесты
- Перед миграцией: `npm run check:assets -- --report-unused` и `npm test`.
- После миграции: `npm run check:assets` и `npm test`.
- Финальный строгий аудит: `npm run check:assets -- --strict-unused`.
- После каждого этапа проверить `git status --short`: только ожидаемые source/doc/assets перемещения и удаление generated/unreferenced файлов; .browser/output/cache не должны вновь добавиться как untracked.

### Критерии приёмки
- Страница продолжает загружать все фотографии, иконки и шрифты из `dist/assets/` на localhost; исходники остаются в `src/assets/`.
- Сканер подтверждает, что все локальные URL разрешаются, в корне нет runtime-media, а директории outputs исключены Git.
- Удалённые backup-файлы не содержали актуального контента конкурса и не были подключены в index.html.
- В рабочем дереве сохранены .ai-factory/, docs/, .codex/config.toml, README.md и AGENTS.md.

### Проверка
- `npm run check:assets -- --strict-unused`
- Ожидаемый результат: missing=0, unused-root-media=0.
- `npm test`
- Ожидаемый результат: все проверки видимости работают с ресурсами из assets/.
- `git status --short`
- Ожидаемый результат: отсутствуют профили, screenshots и cache как untracked; остаются только ожидаемые изменения кода, документации и assets.

## Риски фазы и меры
- Риск: часть unreferenced медиа задумана как будущий контент. Мера: список удаляемых файлов формируется после cross-reference кода и документации; пользователь уже запросил убрать лишнее, будущий контент без ссылки не является runtime asset.
- Риск: asset path меняется только в HTML или только в CSS. Мера: scanner охватывает src/href/url() и локальные строки JS; браузерный тест запускается до удаления копии.
- Риск: широкое правило .gitignore скроет будущий production asset. Мера: не применять *.png и другие расширения целиком; игнорировать только известные директории outputs.

## Критерии завершения фазы
- Task 5 заканчивается только после нулевого strict unused-root-media и прохождения browser suite.
- Ни один проектный документ/файл конфигурации не удалён как временный.
- Единственный progress ledger — checkbox-строки в index.md.
