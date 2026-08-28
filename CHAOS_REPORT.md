# Chaos Report — SoundWave server.js + build scripts

> Статический анализ (без запуска сервера, без сетевых запросов).
> Метод: прослеживание логики кода вручную для экстремальных негативных входных данных.
> Цели: `server.js` (handleProxy, serveStatic), `ios/patch-macho.js`, `ios/make-ipa.js`.

---

## Сводка: 52 сценария, из них 26 вызывают проблему

| Серьёзность | Кол-во | Описание |
|---|---|---|
| **Критические** | 8 | Uncaught Exception / SSRF / падение / hang |
| **Высокие** | 8 | 500 вместо валидации / hang / утечка памяти |
| **Средние** | 10 | Некорректное поведение, не падает |
| **Устойчивые** | 26 | Код переживает сценарий корректно |

**Топ-3 самые опасные находки:**
1. **Path traversal** через `%2f` двойное кодирование + баг `startsWith` prefix-check в `serveStatic` (server.js:139) — прямой доступ к файлам вне ROOT.
2. **SSRF через DNS-rebinding** — DoH-резолвер (server.js:32-51) не валидирует возвращённые IP против внутренних диапазонов; `proxyViaNode` подключается к `127.0.0.1:443` если DoH вернёт loopback.
3. **Infinite loop в `patch-macho.js`** — `while (buf[e] !== 0) e++` (строка 52) зацикливается, если имя dylib не имеет null-терминатора: `buf[e]` возвращает `undefined` (не `0`) при выходе за границу буфера.

---

## Критические (Uncaught Exception / SSRF / падение / hang)

| # | Сценарий | Вход | Ожидание | Реальность | Ущерб | Фикс |
|---|---|---|---|---|---|---|
| C1 | **Path traversal через `%2f` + prefix-bug** | `GET /..%2f..%2fsoundwave-evil/secret.txt` | 403 | URL-парсер не декодирует `%2f` → pathname = `/..%2f..%2fsoundwave-evil/secret.txt`; `decodeURIComponent` (стр.135) декодирует `%2f`→`/`; `path.join(ROOT,p)` резолвит `..` и выходит из ROOT → `C:\...\Новая папка (13)\soundwave-evil\secret.txt`; `file.startsWith(ROOT)` (стр.139) проходит, т.к. `soundwave-evil` начинается с `soundwave` | **CWE-22 Path Traversal** — чтение файлов из sibling-директорий, имя которых начинается с `soundwave` | `file === ROOT \|\| file.startsWith(ROOT + path.sep)` |
| C2 | **SSRF через DNS-rebinding** | `GET /sc?url=https://api-v2.soundcloud.com/` при отравленном DoH (возвращает `127.0.0.1`) | Прокси к настоящему SoundCloud | `resolveHost` (стр.32) доверяет DoH без проверки IP; `ip = doh.ips[0]` = `127.0.0.1`; `proxyViaNode` (стр.59) ставит `host: "127.0.0.1"` → HTTPS-запрос на localhost:443; кэш хранит 10 мин (стр.52) | **CWE-918 SSRF** — доступ к внутренним сервисам (метаданные, Redis, и т.д. через 443) | Валидация IP против RFC1918/loopback/link-local; отказ от прямого IP |
| C3 | **patch-macho: нет аргумента** | `node patch-macho.js` (без argv[2]) | Сообщение об ошибке | `file = undefined`; `fs.readFileSync(undefined)` → TypeError | **Uncaught → crash** | Проверка `if (!file) { console.error(...); process.exit(1); }` |
| C4 | **patch-macho: пустой файл** | `node patch-macho.js empty.bin` | Корректная ошибка | `buf` длиной 0; `buf.readUInt32LE(0)` → RangeError «out of range» | **Uncaught → crash** | `if (buf.length < 28) throw new Error('файл слишком мал')` |
| C5 | **patch-macho: не Mach-O** | `node patch-macho.js text.txt` | Корректная ошибка | `buf.readUInt32LE(0) !== 0xfeedfacf` → `throw new Error('не Mach-O 64 LE')` | **Uncaught → crash** (менее критично — явный throw, но без try/catch) | Обернуть в try/catch с человекочитаемой ошибкой |
| C6 | **patch-macho: cmdsize=0 → infinite loop** | Mach-O с `ncmds=1`, `cmdsize=0` в load command | Чтение одной команды и выход | `off += 0` (стр.55) → `off` не меняется → та же команда читается вечно | **HANG** (бесконечный цикл, 100% CPU) | `if (cmdsize < 16 \|\| cmdsize % 8 !== 0) break` |
| C7 | **patch-macho: нет null-терминатора в dylib name** | Mach-O с LC_LOAD_DYLIB, имя без `\x00` | Корректное чтение или ошибка | `while (buf[e] !== 0) e++` (стр.52) → при `e >= buf.length` `buf[e]` возвращает `undefined`; `undefined !== 0` → `true` → цикл бесконечный | **HANG** (бесконечный цикл, 100% CPU) | `while (e < buf.length && buf[e] !== 0) e++` |
| C8 | **patch-macho: crafted ncmds / cmdsize** | Mach-O с `ncmds=0xFFFFFFFF` или `cmdsize` больше буфера | Безопасный выход | `buf.readUInt32LE(off)` при `off >= buf.length` → RangeError; при огромном `ncmds` — быстро выходит за границу | **Uncaught → crash** | Проверка `off + 16 <= buf.length` перед каждым чтением |

---

## Высокие (500 вместо валидации / hang / утечка)

| # | Сценарий | Вход | Ожидание | Реальность | Ущерб | Фикс |
|---|---|---|---|---|---|---|
| H1 | **handleProxy: ошибка после headersSent** | Любой сценарий, где `proxyViaNode` записал заголовки (через `r.pipe(res)`), затем upstream упал | `res.end()` | `catch` на стр.152: `if (!res.headersSent) {...}` — если заголовки уже отправлены, `res.end()` НЕ вызывается | **Hang** — сокет висит до таймаута клиента | В `catch`: `if (!res.headersSent){ res.writeHead(502); } res.end();` |
| H2 | **proxyViaCurl: неограниченный буфер** | Upstream отправляет большой ответ без `\r\n\r\n` (или curl `-i` без заголовков при ошибке) | Ограничение памяти | `buf = Buffer.concat([buf, d])` (стр.87) растёт без лимита; `--max-time 40` ограничивает время, но не размер | **Утечка памяти / OOM** | Лимит: `if (buf.length > 65536 && !headerDone) { child.kill(); res.writeHead(502); res.end(); }` |
| H3 | **proxyViaCurl: writeHead с `\n` в значении заголовка** | Upstream отправляет `Content-Type: text/html\nSet-Cookie: evil` (bare LF без CR) | Санитизация или пропуск | `split('\r\n')` (стр.91) не разделяет по bare `\n`; значение содержит `\n`; `res.writeHead(status, h)` (стр.101) — Node валидирует значения и бросает TypeError | **Uncaught Exception → crash** (в callback, вне try/catch) | Санитизировать: `v = v.replace(/[\r\n]/g, ' ')` перед записью в `h` |
| H4 | **hostMethod map никогда не очищается** | Запрос к хосту, где node-метод упал → переключился на curl; curl недоступен | Fallback или сброс | `hostMethod.set(target.hostname, 'curl')` (стр.126) — запись без TTL; при отсутствии `curl` все последующие запросы к этому хосту → 502 | **Персистентный отказ** для хоста до перезапуска | TTL-записи или `delete` при ошибке curl |
| H5 | **make-ipa: отсутствует SoundWave binary** | `ios/SoundWave` не существует | Понятная ошибка | `fs.copyFileSync(path.join(ROOT, 'SoundWave'), ...)` → ENOENT | **Uncaught → crash** | Проверка существования перед copy |
| H6 | **make-ipa: отсутствует Info.plist / icons / ../index.html** | Любой из копируемых файлов отсутствует | Понятная ошибка | `copy('Info.plist', ...)` / `copy('icons/...', ...)` / `fs.copyFileSync('../index.html', ...)` → ENOENT | **Uncaught → crash** | Проверка существования всех файлов перед сборкой |
| H7 | **make-ipa: `tar` не на PATH** | Windows без bsdtar (старые версии) | Понятная ошибка | `execFileSync('tar', ...)` → ENOENT | **Uncaught → crash** | Проверка `which tar` или fallback на `archiver`/`yazl` |
| H8 | **make-ipa / patch-macho: нет прав на запись** | Файл/директория read-only | Понятная ошибка | `fs.writeFileSync` / `fs.mkdirSync` → EACCES/EPERM | **Uncaught → crash** | try/catch с понятным сообщением |

---

## Средние (некорректное поведение, не падает)

| # | Сценарий | Вход | Ожидание | Реальность | Фикс |
|---|---|---|---|---|---|
| M1 | **Длинный hostname (15KB)** | `url=http://aaaa...(15KB)...aaaa!` | Быстрый 403 | `HOST_OK` regex: `([a-z0-9-]+\.)*` отрабатывает за O(n), не катастрофический, но CPU-spike на 15KB | Лимит длины hostname (e.g. 255 байт — RFC 1035) |
| M2 | **Схема игнорируется** | `url=ftp://soundcloud.com/` | 403 (только https) или корректный ftp | `HOST_OK` проходит (hostname = soundcloud.com); `proxyViaNode` всегда `https.get` port 443 — схема проигнорирована; `proxyViaCurl` отправляет `target.href` → curl делает FTP/HTTP запрос | Проверка `target.protocol === 'https:'` |
| M3 | **Порт игнорируется в proxyViaNode** | `url=https://soundcloud.com:8443/` | Подключение к :8443 | `proxyViaNode` хардкодит `port: 443` (стр.61); порт из URL проигнорирован; `proxyViaCurl` использует `target.href` → порт учитывается; **несогласованное поведение** между методами | Использовать `target.port \|\| 443` |
| M4 | **Range: bytes=evil** | `Range: bytes=evil` | Валидация Range | `range` передаётся как-is в upstream (стр.66, 81) — upstream вернёт 416/400; не крашит, но прокси пропускает невалидный Range | Базовая валидация формата Range |
| M5 | **Огромный Range** | `Range: bytes=999999999999-` | Нормально | Проксируется на upstream; SoundCloud вернёт 416; не крашит | — |
| M6 | **Повторяющийся `url`** | `?url=https://soundcloud.com/&url=http://evil.com/` | Последнее значение или ошибка | `searchParams.get('url')` возвращает **первое** значение; второе игнорируется | Задокументировать поведение |
| M7 | **`ping` обходит валидацию** | `?url=javascript:alert(1)&ping=1` | Валидация url | `has('ping')` проверяется первым (стр.111) → возвращает `{"ok":true}` без проверки `url`; **безопасно** (прокси не вызывается), но неинтуитивно | — |
| M8 | **`/sc` prefix слишком широкий** | `GET /scfoo` или `GET /sc.json` | 404 (статика) | `req.url.startsWith('/sc')` (стр.152) → всё, начинающееся с `/sc`, идёт в handleProxy; без `url` → 400 | `req.url === '/sc' \|\| req.url.startsWith('/sc?')` |
| M9 | **DoH-кэш отравлен на 10 мин** | DoH вернул `127.0.0.1` → кэшируется | Короткий TTL | `dohCache` хранит 6e5 мс (10 мин); все запросы в окне используют отравленный IP | Сократить TTL; валидация IP |
| M10 | **make-ipa: walk по symlink-loop** | Директория с циклическими symlink | Нормальный обход | `walk` (стр.21) рекурсивен без защиты от циклов → stack overflow | `fs.realpath` + visited-set |

---

## Устойчивые (сценарии, которые код переживает нормально)

| # | Сценарий | Вход | Результат | Почему работает |
|---|---|---|---|---|
| S1 | Пустой `url` | `url=` | 400 «bad url» | `searchParams.get('url')` → `""`; `new URL("")` throws → catch (стр.118) |
| S2 | `url` отсутствует | `?ping=0` без `url` | 400 «bad url» (или `{"ok":true}` если `ping`) | `get('url')` → `null`; `new URL("null")` throws → 400 |
| S3 | `url=null` (литерал) | `url=null` | 400 | `new URL("null")` throws → 400 |
| S4 | `url=undefined` (литерал) | `url=undefined` | 400 | `new URL("undefined")` throws → 400 |
| S5 | Гигантский URL (1МБ) | `url=` + 1МБ символов | 431 / drop | Node HTTP parser (`--max-http-header-size=16KB` default) отклоняет request line до достижения handler |
| S6 | CRLF в `url` (параметр) | `url=https://soundcloud.com/x%0d%0aEvil:%20h` | 403 или прокси | WHATWG URL parser **strips** `\r` и `\n` из URL; CRLF не попадает в pathname/headers |
| S7 | Null-byte в `url` | `url=https://soundcloud.com%00/` | Прокси (null stripped) | URL parser игнорирует U+0000 (validation error, continue) |
| S8 | CRLF в Range header | HTTP-запрос с `Range: bytes=x\r\nEvil: h` | 400/отклонение | Node llhttp parser **отвергает** запрос с bare CR/LF в header value до handler |
| S9 | `file:///c:/windows/win.ini` | `url=file:///c:/windows/win.ini` | 403 «host not allowed» | `target.hostname` = `""` (пусто); `HOST_OK.test("")` → false → 403 |
| S10 | `javascript:alert(1)` | `url=javascript:alert(1)` | 403 | `hostname` = `""` → 403 |
| S11 | `data:text/html,x` | `url=data:text/html,x` | 403 | `hostname` = `""` → 403 |
| S12 | `http://169.254.169.254/` | AWS metadata | 403 | `HOST_OK` не матчит (не заканчивается на soundcloud.com) |
| S13 | `http://127.0.0.1:6379/` | Redis SSRF | 403 | Не матчит HOST_OK |
| S14 | `http://localhost/` | Localhost SSRF | 403 | Не матчит HOST_OK |
| S15 | `http://[::1]/` | IPv6 loopback SSRF | 403 | Не матчит HOST_OK |
| S16 | `http://0.0.0.0/` | Wildcard SSRF | 403 | Не матчит HOST_OK |
| S17 | `http://soundcloud.com@169.254.169.254/` | Userinfo-rebind SSRF | 403 | WHATWG parser: hostname = `169.254.169.254` (userinfo до `@` отброшен) → не матчит HOST_OK |
| S18 | `http://soundcloud.com.evil.com/` | Suffix-bypass | 403 | hostname заканчивается на `evil.com`, regex требует `$` после `soundcloud.com` → не матчит |
| S19 | `http://x.soundcloud.com/` | Subdomain | 200 (прокси) | Корректно — легитимный subdomain, regex `([a-z0-9-]+\.)*` матчит `x.` |
| S20 | `http://sоundcloud.com/` (Cyrillic 'о') | Homograph attack | 403 | WHATWG parser → punycode `xn--...`; HOST_OK не матчит punycode |
| S21 | `http://SOUNDCLOUD.COM/` | Case bypass | 200 (прокси) | Корректно — WHATWG parser lowercases hostname; regex `/i` |
| S22 | `http://soundcloud.com/` (без www) | Bare domain | 200 (прокси) | Корректно — `([a-z0-9-]+\.)*` с `*` допускает 0 групп |
| S23 | Standard path traversal `/../etc/passwd` | `GET /../etc/passwd` | 403 | URL parser резолвит `..` → pathname `/etc/passwd`; `path.join(ROOT, '/etc/passwd')` → внутри ROOT; `fs.readFile` → 404 (файла нет) — но даже если бы был, `startsWith` прошёл бы. **Реальная защита — отсутсвие файла**. Не надёжно, но не падает. |
| S24 | `..%2f..%2f` standard encoding | `GET /..%2f..%2f` | 400 или 403 | `decodeURIComponent('/..%2f..%2f')` → `/../`; URL parser **уже** резолвит `..` в pathname если `/` literal; но `%2f` не декодируется URL parser → `decodeURIComponent` декодирует → `path.join` резолвит → выходит за ROOT → `startsWith` **не проходит** (path не начинается с ROOT) → 403. **Кроме случая C1** (sibling с именем `soundwave*`). |
| S25 | `..\\..\\windows\\win.ini` | Windows backslash traversal | 403 | `path.join` нормализует `..\` → выходит за ROOT → `startsWith(ROOT)` false → 403 |
| S26 | Невалидное percent-encoding `%ZZ` | `GET /%ZZ` | 400 | `decodeURIComponent` throws → catch (стр.136) → 400 |

---

## Рекомендованные регрессионные тесты (assert'ы)

### serveStatic
```js
// C1: path traversal через %2f + prefix-bug
assert(response_for('/..%2f..%2fsoundwave-evil/secret.txt').status === 403);
// Должен читать ТОЛЬКО внутри ROOT + path.sep
assert(file.startsWith(ROOT + path.sep) === true);

// S26: невалидное percent-encoding
assert(response_for('/%ZZ').status === 400);

// S25: Windows backslash traversal
assert(response_for('/..%5c..%5cwindows%5cwin.ini').status === 403);
```

### handleProxy
```js
// S1-S4: пустые/отсутствующие url
assert(response_for('/sc?url=').status === 400);
assert(response_for('/sc').status === 400);
assert(response_for('/sc?url=null').status === 400);
assert(response_for('/sc?url=undefined').status === 400);

// S9-S11: запрещённые схемы
assert(response_for('/sc?url=file:///c:/windows/win.ini').status === 403);
assert(response_for('/sc?url=javascript:alert(1)').status === 403);
assert(response_for('/sc?url=data:text/html,x').status === 403);

// S12-S16: SSRF к внутренним адресам
assert(response_for('/sc?url=http://169.254.169.254/').status === 403);
assert(response_for('/sc?url=http://127.0.0.1:6379/').status === 403);
assert(response_for('/sc?url=http://localhost/').status === 403);
assert(response_for('/sc?url=http://[::1]/').status === 403);
assert(response_for('/sc?url=http://0.0.0.0/').status === 403);

// S17: userinfo-rebind
assert(response_for('/sc?url=http://soundcloud.com@169.254.169.254/').status === 403);

// S18: suffix-bypass
assert(response_for('/sc?url=http://soundcloud.com.evil.com/').status === 403);

// S20: Cyrillic homograph
assert(response_for('/sc?url=http://sоundcloud.com/').status === 403); // Cyrillic 'о'

// C2: DNS-rebinding — DoH возвращает 127.0.0.1
mockDoH('api-v2.soundcloud.com', ['127.0.0.1']);
assert(resolvedIpIsBlocked('127.0.0.1') === true); // IP должен быть отклонён

// M2: схема только https
assert(response_for('/sc?url=ftp://soundcloud.com/').status === 403);

// M8: /sc prefix слишком широкий
assert(response_for('/scfoo').status !== 200); // не должно быть прокси

// H1: error after headersSent → res.end() всегда вызывается
// (требует mock upstream error после writeHead)
```

### patch-macho.js
```js
// C3: нет аргумента
assert.exitCode('node patch-macho.js', 1);
assert.stderr(/usage/i);

// C4: пустой файл
assert.exitCode('node patch-macho.js empty.bin', 1);
assert.stderr(/слишком мал/i);

// C5: не Mach-O
assert.exitCode('node patch-macho.js text.txt', 1);
assert.stderr(/не Mach-O/i);

// C6: cmdsize=0 → не должен hang'нуть
const crafted = makeMachO({ ncmds: 1, cmdsize: 0 });
assert.completesWithin('node patch-macho.js crafted.bin', 2000); // 2s timeout

// C7: no null terminator → не должен hang'нуть
const crafted2 = makeMachOWithDylib('no-null-terminator'); // без \x00
assert.completesWithin('node patch-macho.js crafted2.bin', 2000);

// C8: огромный ncmds → корректная ошибка, не краш
const crafted3 = makeMachO({ ncmds: 0xFFFFFFFF });
assert.exitCode('node patch-macho.js crafted3.bin', 1);
assert.stderr(/out of range/i);
```

### make-ipa.js
```js
// H5: отсутствует SoundWave binary
assert.exitCode('node make-ipa.js', 1); // без SoundWave в ios/
assert.stderr(/SoundWave/);

// H7: tar не на PATH (mock)
mockMissing('tar');
assert.exitCode('node make-ipa.js', 1);
assert.stderr(/tar/);
```

---

## Приложение: карта кода

| Функция | Строки | Ключевые риски |
|---|---|---|
| `handleProxy` | 109-129 | C2 (SSRF), H1 (hang), M2-M8 (поведение) |
| `proxyViaNode` | 57-76 | C2 (использует DoH IP как host), H1 (pipe error) |
| `proxyViaCurl` | 78-107 | H2 (unbounded buf), H3 (writeHead crash) |
| `resolveHost` | 32-51 | C2 (нет валидации IP), M9 (cache TTL) |
| `serveStatic` | 132-149 | **C1** (path traversal via %2f + startsWith) |
| `patch-macho.js` | 1-59 | C3-C8 (краши и hang'и на malformed Mach-O) |
| `make-ipa.js` | 1-33 | H5-H8 (краши на отсутствующих файлах/tar) |
