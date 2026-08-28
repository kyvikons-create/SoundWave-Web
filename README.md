# SoundWave 🎵

Красивый неофициальный плеер для прослушивания музыки из SoundCloud.
Интерфейс в стиле iOS: тёмная тема, большой экран плеера с размытым фоном,
свайпы, мини-плеер, поиск, жанры, любимые треки и история.

## Что умеет

- 🔍 **Поиск** треков по названию, исполнителю, жанру
- 🎧 **Обзор** — подборки по жанрам (хип-хоп, электроника, phonk, lofi…)
- ❤️ **Любимые** — сохраняются на устройстве, работают офлайн-списком
- 🕘 **История** прослушивания
- ▶️ Полноценный плеер: очередь, перемешивание, повтор, автоплей похожих
- 🔒 Управление с экрана блокировки и наушников (Media Session)
- 📱 Устанавливается на iPhone как приложение («На экран Домой»)

## Как запустить (нужен один раз, на компьютере)

Требуется [Node.js](https://nodejs.org) (кнопка LTS → установить).

1. Дважды щёлкните **`start.bat`** (или выполните `node server.js` в этой папке).
2. В окне появится адрес вида `http://192.168.x.x:3000`.
3. Откройте его в **Safari на iPhone** (компьютер и телефон — в одной сети Wi-Fi).
4. Нажмите **Поделиться → «На экран “Домой”»** — появится иконка SoundWave.

Запускать сервер нужно, пока слушаете. Закрыли окно — откройте `start.bat` снова.

## Почему нужен сервер

Браузер не может обращаться к API SoundCloud напрямую (CORS), а некоторые
провайдеры дополнительно блокируют `api-v2.soundcloud.com`. `server.js`
проксирует запросы: резолвит адреса через DNS-over-HTTPS и при необходимости
использует curl. Аудио при этом грузится напрямую с CDN SoundCloud — быстро.

## Если треки перестали грузиться

SoundCloud периодически меняет ключ доступа (client_id). Откройте вкладку
**«Ещё» → Подключение → «Найти автоматически»** — приложение само найдёт
новый ключ. Можно также вставить свой ключ вручную.

## Хостинг в интернете

Папку можно выложить на любой статический хостинг (например,
[Netlify Drop](https://app.netlify.com/drop) — перетащить папку). Учтите:
без локального сервера приложение будет пытаться использовать публичные
CORS-прокси, что менее надёжно, чем запуск `start.bat` дома.

## Технические детали

- Один файл интерфейса: `index.html` (без зависимостей и сборки)
- `server.js` — статика + прокси API (Node.js, без npm-пакетов)
- `make-icons.ps1` — перегенерация иконок (PowerShell + GDI+)
- Данные (любимые, история, ключ) — в localStorage Safari

## Безопасность

Прокси `/sc` работает только с двумя хостами — `soundcloud.com` и `sndcdn.com`:
домен проверяется регуляркой `HOST_OK` с привязкой `^…$`, поэтому суффикс-подделки
(`soundcloud.com.evil.com`), кириллические омоглифы (через punycode в `new URL().hostname`)
и схемы `file:`/`javascript:`/`data:` (пустой `hostname`) отсекаются — произвольный
SSRF через `/sc?url=` невозможен. Дополнительно в `server.js` усилено:

- **`isPublicIP`** — IP, полученные от DoH-резолвера, проверяются против приватных и
  зарезервированных диапазонов (IPv4 `10/8`/`127/8`/`169.254/16`/`172.16/12`/`192.168/16`/
  `0/8`/`224/4`/`240/4`; IPv6 `::1`/`::`/`fe80::/10`/`fc00::/7`, включая IPv4-mapped
  `::ffff:a.b.c.d`). Отравленный DoH, вернувший `127.0.0.1` или `169.254.169.254`,
  отбрасывается — SSRF через DNS-rebinding закрыт (C2 из CHAOS_REPORT).
- **`resolveStaticPath`** — путь статики резолвится через `path.normalize`+`path.join`,
  а выход за пределы `root` ловится через `path.relative` (`rel.startsWith('..')` или
  `path.isAbsolute(rel)`). Path-traversal через `%2f`/`%5c` и коллизию префикса
  `soundwave*` отсечён (C1/L-3).
- **`sanitizeRange`** — заголовок `Range` пропускается через строгую регулярку
  `^bytes=\d{0,19}-\d{0,19}$`; мусор и CRLF-инъекции вида `bytes=0-1\r\nX: e` отбрасываются.
- **Whitelist заголовков ответа** — upstream'у форвардятся только `content-type`/
  `content-length`/`content-range`/`accept-ranges`; `Set-Cookie`, `Location`, `Server`
  не пробрасываются (нет утечки cookies/open-redirect через прокси). Проверка
  сертификата TLS страхует от DNS-rebinding на транспортном уровне. В `server.js` нет
  захардкоженных `client_id` и токенов, в логи попадает лишь стартовая плашка
  (параметры запросов и ключи не пишутся).

В iOS build-скриптах **`patch-macho.js`** усилен по всем атакным поверхностям CHAOS.
Атакующие входы теперь не крашат процесс с трассировкой, а дают читаемую ошибку и
`exit(1)`: нет аргумента → `usage: node patch-macho.js <file> [write]` (фикс C3),
пустой/короткий файл (< 32 байт) → `слишком короткий/пустой файл: N байт` (фикс C4),
не-Mach-O → `не Mach-O 64 LE` (фикс C5 — graceful вместо uncaught throw; покрыто
spawn-тестом «падает с понятной ошибкой на не-Mach-O файле» в `ios/test/build.test.js`),
а весь разбор заголовков обёрнут в `try/catch`. От зацикливания на malformed Mach-O
тоже защищено: цикл чтения имени dylib ограничен `e < buf.length` (фикс C7 — infinite
loop без null-терминатора), обход load-команд прерывается при `cmdsize < 8` либо выходе
`off` за границу буфера (фикс C6/C8).

Таким образом **все 8 критических находок CHAOS** ныне mitigated/fixed: C1
(path-traversal) и C2 (SSRF) — валидаторы `server.js` (`HOST_OK`/`isPublicIP`/
`resolveStaticPath`/`sanitizeRange`), покрыты `test/chaos.test.js`; C6/C7/C8 —
bounds-проверки `patch-macho.js`; C3/C4/C5 — graceful-обработка `patch-macho.js`
(в отчёте перепроверки были RESIDUAL, позже исправлены в коде). Сводка —
[CHAOS_RETTEST.md](CHAOS_RETTEST.md) (5 MITIGATED, 3 RESIDUAL → fixed в коде).

Часть рисков пока **НЕ** усилена и зафиксирована как backlog (требует правки `index.html`):

- **UI-1 (High) — утечка `client_id` в публичные CORS-прокси.** При отсутствии
  локального прокси запросы `api-v2.soundcloud.com` (с `client_id` в query) и лирики
  уходят на `corsproxy.io` / `api.allorigins.win` — ключ и метаданные прослушивания
  логируются их владельцами (`index.html:607-608,619`). Фикс: не пускать `p1`/`p2` на
  URL с `client_id=` и на api/лирику.
- **UI-2 (High) — persisted-XSS через `data-*` без `esc()`.** В шаблонах `trackRow`/
  `renderPlRows`/`renderQueue`/`renderLib` значения `id`/`uid`/`pl.id` интерполируются
  в `data-tid`/`data-uid`/`data-like`/`data-pl`/`data-pll`/`data-addpl` без
  экранирования, а импорт настроек не валидирует, что `id` — число. Через «поделённый
  экспорт» можно внедрить `id="x" ontouchstart="…"` → кража `sw_cid` и `localStorage`
  (`index.html:971,980,1077,1224,1258,1441,1829-1831`). Фикс: `Number(t.id)` в
  `normTrack` + фильтр импорта + `esc()` в `data-*`.
- **UI-3 (Medium) — отсутствие Content-Security-Policy.** Ни meta-CSP, ни серверного
  заголовка нет; любая XSS-дыра (UI-2) сразу даёт full compromise — чтение `localStorage`,
  вызов нативного моста iOS, эксфильтрация. Инлайн `onerror=` требует `'unsafe-inline'`
  в `script-src` (`index.html:1-16,526,972,997,1078,1443,1715,1741`). Фикс: meta-CSP с
  белым списком `connect-src` + убрать инлайн-обработчики.

Полные детали, разбор по уровням (Critical/High/Medium/Low) и рекомендованные фиксы — в
[SECURITY_AUDIT.md](SECURITY_AUDIT.md), [CHAOS_REPORT.md](CHAOS_REPORT.md) и
[UI_SECURITY.md](UI_SECURITY.md).

Напоминаем: SoundWave — неофициальный клиент для личного использования
(подробнее — в разделе «Важно» ниже). Запускайте прокси на своей машине или
домашней сети и не выставляйте порт наружу.

## Docker

SoundWave упакован в контейнер — удобно поднять на домашнем сервере или NAS без
ручной установки Node.js:

```bash
docker compose up
```

Сервис доступен на http://localhost:3000 (порт меняется через переменную `PORT`).
Образ построен на `node:22-alpine`, запускается от непривилегированного
пользователя и включает встроенный healthcheck (`/sc?ping=1`). Детали — в
[Dockerfile](Dockerfile) и [docker-compose.yml](docker-compose.yml).

> С телефона открывайте LAN-IP компьютера (`http://<IP>:3000`), а не `localhost`.

## Тесты

Тесты написаны на встроенном `node:test` (ассерты — `node:assert/strict`), внешних
npm-зависимостей нет — достаточно Node.js 18+. Команды ниже запускаются из папки
`soundwave/`. В репозитории 5 наборов:

```bash
# 1. Unit-тесты сервера: HOST_OK (whitelist хостов — суффикс/омограф/userinfo-ребинд),
#    isPublicIP (приватные/loopback/link-local/reserved IPv4+IPv6 против SSRF),
#    sanitizeRange (CRLF-инъекция в Range), resolveStaticPath (path-traversal через
#    %2f/%5c и коллизию префикса). server.js при require() не стартует — экспорт чистый.
node --test test/server.test.js

# 2. Интеграция/E2E: стартует копию server.js в изолированной temp-папке на случайном
#    порту; проверяет /sc?ping=1 → 200 {ok:true}, / и /index.html → text/html,
#    /icons/icon-192.png → image/png, 404 на несуществующем файле, 403 на чужом хосте
#    (/sc?url=http://evil.com/), 400 без url и на not-a-url.
node --test test/e2e.test.js

# 3. Фронтенд smoke-проверки index.html: <title>SoundWave</title>, PWA-манифест,
#    apple-touch-icon/icon-192, theme-color #08080d, классы .searchbar/.chip/.scroll/.hero-t,
#    отсутствие eval(, размер >50KB, >1500 строк.
node --test test/ui-smoke.test.js

# 4. iOS build-скрипты: gen-tbds.js (генерация .tbd), patch-macho.js (патч платформы
#    Mach-O, корректная ошибка на не-Mach-O и malformed-входе, отсутствие hang'а) и
#    структурный smoke-test make-ipa.js.
node --test ios/test/build.test.js

# 5. Adversarial/chaos-регрессионные тесты: path-traversal через %2f + sibling-collision
#    (C1), SSRF через DNS-rebinding и HOST_OK bypass — suffix/homograph/userinfo (C2),
#    CRLF-инъекция в Range (P3), опасные URL-схемы (file/javascript/data), гигантские
#    входы и null/undefined. Не дублирует server.test.js — только граничные/adversarial
#    кейсы. Из 8 критических находок CHAOS_REPORT.md: 5 mitigated (C1, C2, C6, C7, C8),
#    3 fixed (C3, C4, C5 — patch-macho graceful). Сводка — CHAOS_RETTEST.md.
node --test test/chaos.test.js
```

Запустить все найденные `*.test.js` разом (рекурсивно подхватит все 5 наборов):

```bash
node --test
```

Сценарии-оригиналы для регрессионных тестов (path-traversal через `%2f`, SSRF через
DNS-rebinding, CRLF в Range, malformed Mach-O) расписаны в [CHAOS_REPORT.md](CHAOS_REPORT.md)
— раздел «Рекомендованные регрессионные тесты» — и теперь покрыты реализованными
валидаторами `HOST_OK`/`isPublicIP`/`sanitizeRange`/`resolveStaticPath`.

## Важно

SoundWave — неофициальный клиент для личного использования. Весь контент
принадлежит SoundCloud и правообладателям. Приложение не входит в аккаунт
SoundCloud: любимые хранятся локально, а не в облаке.
