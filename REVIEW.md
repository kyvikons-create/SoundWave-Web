# Review — SoundWave Night Gate

Дата: 2026-08-28
Ревьюер: Agent-Critic (opencode)
База: `C:\Users\User\Desktop\Новая папка (13)\soundwave`
ОС: Windows PowerShell, Node v26.1.0, `node:test`, zero npm-deps.
Режим: только чтение + запуск; исходный код не правился; коммитов нет.

## Вердикт: BLOCK

Ядро функционально зелёное (все 91 тест канонического рекурсивного прогона
проходят, линт 10/10 OK, артефакты на месте, фиксы реально в коде), но есть
несоответствия и нестабильность, которые по критериям гейта не дают чистый
APPROVE. Блокеры перечислены ниже — все починяемы за утро без правки логики.

## Линт

`node --check` всех JS (10 файлов).

| Файл | Результат |
|---|---|
| `server.js` | OK |
| `ios/patch-macho.js` | OK |
| `ios/make-ipa.js` | OK |
| `ios/gen-tbds.js` | OK |
| `ios/dump-macho.js` | OK |
| `test/server.test.js` | OK |
| `test/e2e.test.js` | OK |
| `test/ui-smoke.test.js` | OK |
| `test/chaos.test.js` | OK |
| `ios/test/build.test.js` | OK |

**Итого линт: 10/10 OK.** Красного нет.

## Тесты

### Поштучный прогон (по одному файлу, как в ШАГ 2)

Первый прогон каждого файла запускался параллельно (5 процессов `node --test`
одновременно) — это воспроизвело флейки e2e (см. ниже).

| Набор | tests | pass | fail | skip |
|---|---:|---:|---:|---:|
| `test/server.test.js` | 25 | 25 | 0 | 0 |
| `test/e2e.test.js` (параллель, 1-й прогон) | 8 | 0 | 0 | **8** |
| `test/ui-smoke.test.js` | 19 | 19 | 0 | 0 |
| `test/chaos.test.js` | 22 | 22 | 0 | 0 |
| `ios/test/build.test.js` | 17 | 17 | 0 | 0 |

### Повторные прогоны e2e (солo, последовательно)

| Запуск | tests | pass | fail | skip |
|---|---:|---:|---:|---:|
| e2e солo #1 | 8 | 8 | 0 | 0 |
| e2e солo #2 | 8 | 8 | 0 | 0 |

e2e проходит солo и в рекурсивном прогоне — флейки только под параллельной
нагрузкой (таймаут `waitForReady` 5с слишком тугой при CPU-конфликте 5 процессов).

### Рекурсивный прогон `node --test` (без аргументов, из папки soundwave)

Каноническая команда из AGENTS.md.

| Набор | tests | pass | fail | skip |
|---|---:|---:|---:|---:|
| все `*.test.js` разом | **91** | **91** | **0** | **0** |

Внутри: gen-tbds(8) + patch-macho(3) + make-ipa(6) + chaos(22) + e2e(8) +
HOST_OK(7) + isPublicIP(6) + sanitizeRange(5) + resolveStaticPath(5) +
server.js exports(2) + ui-smoke(18) = 91. e2e здесь прошёл полностью (8/8).

### `node --test "<путь-к-папке-test>"` (папка как аргумент)

| Запуск | tests | pass | fail | skip |
|---|---:|---:|---:|---:|
| `node --test "...\\test"` | 1 | 0 | **1** | 0 |

В Node v26.1.0 передача директории аргументом падает с `MODULE_NOT_FOUND`
(Node трактует путь как файл). Рекурсивно работает только `node --test` без
аргументов (что и задокументировано в AGENTS.md). Не баг док-ции, но note.

## ИТОГО тестов

- **Канон (рекурсивный `node --test`): 91 pass / 0 fail / 0 skip** — зелёное.
- Поштучный параллельный прогон: 83 pass / 0 fail / 8 skip (всё skip — флейки e2e).
- Поштучный последовательный (e2e пересмотрен): 91 pass / 0 fail / 0 skip.

## Артефакты

### Безопасность (отчёты) — все на месте

| Файл | Существует |
|---|---|
| `SECURITY_AUDIT.md` | ✅ |
| `CHAOS_REPORT.md` | ✅ |
| `UI_SECURITY.md` | ✅ |
| `CHAOS_RETTEST.md` | ✅ |

### Docker — все на месте

| Файл | Существует |
|---|---|
| `Dockerfile` | ✅ |
| `docker-compose.yml` | ✅ |
| `.dockerignore` | ✅ |

### Тесты — все на месте

| Файл | Существует |
|---|---|
| `test/server.test.js` | ✅ |
| `test/e2e.test.js` | ✅ |
| `test/ui-smoke.test.js` | ✅ |
| `test/chaos.test.js` | ✅ |
| `ios/test/build.test.js` | ✅ |

### Доки

| Файл | Существует | Обновлён? |
|---|---|---|
| `README.md` | ✅ | Да (описывает security-фиксы, Docker, тесты) |
| `AGENTS.md` (корень `..\AGENTS.md`) | ✅ | Да |

## Сверка фиксов с кодом

### `server.js` exports (требование: HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath)

Проверка через `require()`:

```
exports keys: [ 'HOST_OK', 'isPublicIP', 'sanitizeRange', 'resolveStaticPath' ]
types: HOST_OK:object, isPublicIP:function, sanitizeRange:function, resolveStaticPath:function
```

В коде: `module.exports = { HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath };`
Ровно 4 сущности, корректных типов. Сетевых/прокси-функций не экспортируется
(no SSRF surface via require — подтверждено одноимённым тестом в server.test.js).
**Фиксы реальны, не только в отчётах.** ✅

### `ios/patch-macho.js` — graceful errors

В коде подтверждены защитные ветки (по строкам):

- L7: `console.error('usage: node patch-macho.js <file> [write]')` — Usage-ошибка
- L11: `console.error('файл не найден: ' + file)` — graceful на отсутствии файла
- L16: `console.error('слишком короткий/пустой файл: ...')` — защита от пустого/короткого
- L20: `console.error('не Mach-O 64 LE')` — понятная ошибка на не-Mach-O
- L24: `try {` ... L81: `} catch (e) {`
- L82: `console.error('ошибка обработки: ' + e.message)` — обёртка обработки

Цикл чтения dylib ограничен (`e < buf.length`), обход load-команд прерывается при
`cmdsize < 8`/выходе `off` за буфер (фиксы C6/C7/C8 из README/CHAOS_REPORT).
Покрыто тестом `ios/test/build.test.js` (3 теста patch-macho: платформа, dylib, not-Mach-O).
**Фиксы реальны.** ✅

## Замечания / несоответствия

### 🔴 Блокер 1 — e2e.test.js флейки под параллельной нагрузкой

При поштучном параллельном прогоне (5 процессов `node --test` одновременно, как
предписано в ШАГ 2) e2e дал **8 SKIP** с причиной `server not ready within 5s`
(`waitForReady`, `e2e.test.js:42`). При солo-прогоне и в рекурсивном `node --test`
e2e проходит (8/8). Корень: таймаут 5с слишком тугой под CPU-конфликтом — спавн
`node server.js` + первый HTTP-ответ не успевают уложиться. Это нестабильность
теста, а не дефект сервера (сервер отвечает нормально — доказано солo/рекурсивно).

### 🔴 Блокер 2 — док-ция расходится с реальностью по числу тест-наборов

- `README.md:134`: «В репозитории 4 набора» и перечислены только
  `server.test.js` / `e2e.test.js` / `ui-smoke.test.js` / `build.test.js`.
- `AGENTS.md:28-32`: тот же список из 4 наборов, «4 набора» в строке 66-68.
- **Реальность:** 5 тест-файлов — существует и проходит `test/chaos.test.js`
  (22 теста, adversarial-сценарии path-traversal/SSRF/CRLF/null-входы).
  Рекурсивный `node --test` подхватывает **5** наборов, не 4.
  `chaos.test.js` нигде в README/AGENTS не упомянут → несоответствие.

### 🟡 Замечание 3 — `node --test "<директория>"` падает

Передача пути к папке как аргумента (`node --test "...\\test"`) в Node v26.1.0
падает с `MODULE_NOT_FOUND` (директория трактуется как файл). Рекурсивно работает
только `node --test` без аргументов — что и задокументировано в AGENTS.md. Не баг
док-ции, но стоит явно отметить в README, что «все разом» = `node --test` без
аргументов (сейчас в README:163 так и написано — консистентно).

### 🟡 Замечание 4 — backlog-риски UI (UI-1/UI-2/UI-3) открыто зафиксированы

`README.md:86-104` и `UI_SECURITY.md` честно перечисляют НЕпочиненные UI-риски
(утечка `client_id` в CORS-прокси UI-1 High; persisted-XSS через `data-*` без
`esc()` UI-2 High; отсутствие CSP UI-3 Medium). Это не баги ночного гейта — это
задокументированный backlog с указанными фиксами. Не блокер, но вниманию утра.

## Рекомендации на утро

1. **e2e-стабильность (блокер 1):** поднять таймаут `waitForReady` с 5с до ~15–30с
   (`e2e.test.js:42`) и/или опросить чаще/жёстче; опционально — retry спавна при
   раннем exit. После правки — прогнать e2e параллельно 5× для подтверждения.
2. **Док-ция (блокер 2):** добавить `test/chaos.test.js` в список тестов в
   `README.md` (раздел «Тесты», ~L136-158) и в `AGENTS.md` (~L28-32); заменить
   «4 набора» → «5 наборов» в README:134 и AGENTS:67.
3. (Опц.) Отразить в AGENTS.md, что поштучный lint покрывает и `test/*.test.js`
   (сейчас lint-список AGENTS:22-26 только для прод-скриптов).
4. UI-бэклог (UI-1/UI-2/UI-3) оставить как приоритет на следующую ночь —
   зафиксирован прозрачно, не блокирует текущий гейт.

## Финал

- **Вердикт: BLOCK** (мягкий — ядро зелёное, блокеры = флейки e2e + док-ция).
- **Тесты (канон `node --test`): 91 pass / 0 fail / 0 skip.**
- **Линт: 10/10 OK.**
- **Блокеры:** (1) e2e флейки → 8 skip при параллельном прогоне; (2) README/AGENTS
  говорят «4 набора» и не упоминают `test/chaos.test.js` (реально 5 наборов).
- `REVIEW.md` создан.
