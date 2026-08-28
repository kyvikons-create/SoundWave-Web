# CHAOS_RETTEST — перепроверка 8 критических находок CHAOS_REPORT.md

> Агент: Chaos Re-tester #2. Цель: захардененный `server.js` SoundWave.
> Метод: статический анализ + регрессионные adversarial-тесты (`test/chaos.test.js`).
> Тест-раннер: `node:test` + `node:assert/strict`. Zero npm deps. Node v26.1.0, Windows.
> `chaos.test.js` покрывает находки, доступные через экспорты `server.js`
> (`HOST_OK`, `isPublicIP`, `sanitizeRange`, `resolveStaticPath`). C3-C8
> (`ios/patch-macho.js`) не покрываются `chaos.test.js` — требуют `spawn`
> процесса патча с crafted Mach-O; статус определён статическим анализом
> исходника `patch-macho.js` (агент не правит этот файл).
>
> **UPDATE (финал ночи):** C3, C4, C5 позже исправлены отдельным Backend-fix
> агентом — graceful `console.error` + `process.exit(1)` + `try/catch`.
> Статусы ниже обновлены до FIXED. Спавн-тесты в `build.test.js` —
> рекомендованы на утро.

## Сводка

| Статус | Кол-во | Находки |
|---|---|---|
| **MITIGATED** | 5 | C1, C2, C6, C7, C8 |
| **FIXED** | 3 | C3, C4, C5 (доп. фикс ночью: graceful errors + try/catch в `patch-macho.js`) |
| **RESIDUAL** | 0 | — |

**Результат прогона `node --test test/chaos.test.js`:** 22 теста, 22 pass, 0 fail, 0 skip.
**Полный набор `node --test` (soundwave):** 91 тест, 91 pass, 0 fail — regression не сломана.

---

## Детально по 8 критическим находкам

### C1 — Path traversal через `%2f` + prefix-bug (`serveStatic`)
- **Статус:** MITIGATED
- **Фикс в коде:** `server.js` `resolveStaticPath` (стр.80-85) использует
  `path.relative(root, file)` + `ok = !(rel.startsWith('..') || path.isAbsolute(rel))`
  вместо уязвимого `file.startsWith(ROOT)`. Это корректная защита от sibling-collision
  (имя `soundwave-evil` больше не пропускается через `startsWith('soundwave')`).
- **Как протестировано (assert):**
  - `resolveStaticPath('/..%2f../', ROOT).ok === false`
  - `resolveStaticPath('/..%5c..%5c', ROOT).ok === false`
  - `resolveStaticPath('/..%2f..%2fsoundwave-evil/x', ROOT).ok === false` (ключевой sibling-collision)
  - `resolveStaticPath('/..%2f..%2fsoundwave-evil/secret.txt', ROOT).ok === false`
  - `resolveStaticPath('/icons/../index.html', ROOT).ok === true` (легитимная нормализация)
  - `resolveStaticPath('/index.html', ROOT).ok === true`
  - `resolveStaticPath('/' + '../'.repeat(100) + 'secret.txt', ROOT).ok === false` (глубокий traversal)
  - `assert.doesNotThrow(() => resolveStaticPath('/' + 'a'.repeat(100000), ROOT))` (DoS-стойкость, ok true)
- **Комментарии:** Полная защита. `path.relative` корректно детектит выход за root
  на всех вариантах кодирования `%2f`/`%5c`, глубоком traversal и sibling-collision.

### C2 — SSRF через DNS-rebinding (`resolveHost`/`proxyViaNode`)
- **Статус:** MITIGATED (с residual-замечанием по CGNAT/benchmark — вне 8 крит)
- **Фикс в коде:** `server.js` `isPublicIP` (стр.42-76) — валидатор IP из DoH
  против loopback/private/link-local/reserved/multicast/broadcast; вызов в `handleProxy`
  (стр.184): `if (ip && !isPublicIP(ip)){ res.writeHead(403); res.end('blocked ip'); return; }`.
  `HOST_OK` (стр.28) — regex с `$` предотвращает suffix-bypass (`soundcloud.com.evil.com`).
- **Как протестировано (assert):**
  - `isPublicIP('169.254.169.254') === false` (AWS metadata!)
  - `isPublicIP('127.0.0.1') === false`, `isPublicIP('10.0.0.1') === false`,
    `isPublicIP('192.168.1.1') === false`
  - `isPublicIP('::1') === false`, `isPublicIP('::ffff:127.0.0.1') === false`
  - `isPublicIP('8.8.8.8') === true`, `isPublicIP('1.1.1.1') === true`
  - `isPublicIP('255.255.255.255') === false`, `isPublicIP('224.0.0.1') === false`,
    `isPublicIP('0.0.0.0') === false`
  - `HOST_OK.test('soundcloud.com.evil.com') === false` (suffix-bypass)
  - `HOST_OK.test('sоundcloud.com') === false` (кириллица U+043E, homograph)
  - `HOST_OK.test(host('http://soundcloud.com@169.254.169.254/')) === false` (userinfo-rebind)
- **Комментарии:** Основа SSRF закрыта. **Residual (не из 8 крит, snapshot-тест):**
  `isPublicIPv4` не проверяет `100.64.0.0/10` (RFC 6598 CGNAT) и `198.18.0.0/15`
  (benchmark) — `isPublicIP('100.64.0.1') === true`. Snapshot-тест фиксирует текущее
  поведение; при добавлении проверки — обновить ожидание на `false`. Также M2 (medium):
  схема URL не валидируется (`ftp://soundcloud.com` проходит `HOST_OK`) — вне 8 крит.

### C3 — patch-macho: нет аргумента (`node patch-macho.js` без argv[2])
- **Статус:** FIXED (доп. фикс ночью)
- **Фикс в коде:** `patch-macho.js` — добавлен guard `if (!file) { console.error('usage: node patch-macho.js <file> [write]'); process.exit(1); }`. При отсутствии argv[2] теперь graceful stderr + `exit(1)` вместо `fs.readFileSync(undefined)` → TypeError crash. Вся логика парсинга/патча обёрнута в `try/catch`.
- **Как протестировано:** ручная проверка через spawn — `node patch-macho.js` (без argv) печатает usage и выходит `exit 1` без стека. `chaos.test.js` не покрывает (требует spawn), статус подтверждён статически + ручным прогоном.
- **Комментарии:** Фикс применён. Рекомендован spawn-тест в `ios/test/build.test.js` для автоматизации.

### C4 — patch-macho: пустой файл (`node patch-macho.js empty.bin`)
- **Статус:** FIXED (доп. фикс ночью)
- **Фикс в коде:** `patch-macho.js` — guard `if (buf.length < 32) { console.error('слишком короткий/пустой файл: ' + buf.length + ' байт'); process.exit(1); }` перед чтением заголовка. Пустой/короткий файл теперь graceful `exit(1)` вместо `buf.readUInt32LE(0)` → RangeError.
- **Как протестировано:** ручная проверка spawn пустого файла (0 байт) → `exit 1`, stderr «слишком короткий/пустой файл: 0 байт». `chaos.test.js` не покрывает (spawn), подтверждено статически + ручным прогоном.
- **Комментарии:** Фикс применён. Рекомендован spawn-тест с 0-байтовым файлом.

### C5 — patch-macho: не Mach-O (`node patch-macho.js text.txt`)
- **Статус:** FIXED (доп. фикс ночью)
- **Фикс в коде:** `patch-macho.js` — `throw new Error('не Mach-O 64 LE')` заменён на `console.error('не Mach-O 64 LE'); process.exit(1);`. Плюс вся логика в `try/catch` → `console.error('ошибка обработки: ' + e.message); process.exit(1);`. Не-Mach-O файл теперь даёт 1 строку в stderr + `exit 1` без трассировки стека.
- **Как протестировано:** ручная проверка spawn текстового файла → `exit 1`, stderr = 1 строка «не Mach-O 64 LE» (без стека).
- **Комментарии:** Фикс применён. Рекомендован spawn-тест с не-Mach-O файлом.

### C6 — patch-macho: `cmdsize=0` → infinite loop
- **Статус:** MITIGATED
- **Фикс в коде:** `patch-macho.js` стр.27: `if (cmdsize < 8 || off + cmdsize > buf.length) break;`
  — `cmdsize < 8` ловит `cmdsize === 0`, `break` прерывает цикл. `off += cmdsize` (стр.59)
  больше не зацикливается, т.к. цикл уже вышел.
- **Как протестировано:** НЕ покрыто `chaos.test.js` (требует crafted Mach-O + spawn с timeout).
  Статус определён статическим анализом исходника.
- **Комментарии:** Рекомендован spawn-тест с `assert.completesWithin(2000)`. Фикс корректен.

### C7 — patch-macho: нет null-терминатора в dylib name → infinite loop
- **Статус:** MITIGATED
- **Фикс в коде:** `patch-macho.js` стр.56: `let e = off + nameOff; while (e < buf.length && buf[e] !== 0) e++;` —
  guard `e < buf.length` предотвращает выход за границу буфера (`buf[e]` больше не возвращает
  `undefined` вечно). Цикл завершается на конце буфера.
- **Как протестировано:** НЕ покрыто `chaos.test.js` (требует crafted Mach-O с LC_LOAD_DYLIB
  без `\x00` + spawn с timeout). Статус определён статическим анализом.
- **Комментарии:** Рекомендован spawn-тест с `assert.completesWithin(2000)`. Фикс корректен.

### C8 — patch-macho: crafted `ncmds` / `cmdsize` → RangeError
- **Статус:** MITIGATED
- **Фикс в коде:** `patch-macho.js` стр.24: `if (off + 8 > buf.length) break;` перед каждым
  чтением load command + стр.27: `if (cmdsize < 8 || off + cmdsize > buf.length) break;`.
  При огромном `ncmds` (0xFFFFFFFF) цикл `for` безопасно выходит через `break` при
  `off + 8 > buf.length`, без `readUInt32LE` за границей.
- **Как протестировано:** НЕ покрыто `chaos.test.js` (требует crafted Mach-O + spawn).
  Статус определён статическим анализом.
- **Комментарии:** Рекомендован spawn-тест с crafted Mach-O и проверкой exit code 1.
  Фикс корректен — все чтения защищены границей буфера.

---

## Дополнительные adversarial-находки (вне 8 крит, покрыты snapshot-тестами)

| Кейс | Статус | Где покрыто |
|---|---|---|
| CGNAT `100.64.0.1` и benchmark `198.18.0.1` проходят как public | RESIDUAL | `chaos.test.js` «C2: RESIDUAL snapshot» |
| `resolveStaticPath(undefined/null, ROOT)` бросает TypeError | RESIDUAL (не достигается в `serveStatic`, т.к. `p` всегда строка из `decodeURIComponent`) | `chaos.test.js` «Adversarial: null/undefined» |
| Схема URL не валидируется — `ftp://soundcloud.com` проходит `HOST_OK` | RESIDUAL (M2, medium) | `chaos.test.js` «Adversarial: опасные схемы» |
| `file://`/`javascript:`/`data:` → пустой hostname → `HOST_OK('') === false` | MITIGATED | `chaos.test.js` «Adversarial: опасные схемы» |

---

## Рекомендации

1. ~~**C3, C4, C5** — добавить в `ios/patch-macho.js` проверки argv/длины/try-catch~~
   **ВЫПОЛНЕНО ночью** — все три теперь graceful `console.error` + `process.exit(1)`.
   Осталось: покрыть их spawn-тестами в `ios/test/build.test.js` (запуск `node patch-macho.js`
   без argv / с пустым файлом / с не-Mach-O, assert exit code === 1 и stderr содержит ожидаемое).
2. **CGNAT/benchmark IP** — добавить в `isPublicIPv4`:
   `if (a === 100 && b >= 64 && b <= 127) return false;` (RFC 6598)
   `if (a === 198 && b >= 18 && b <= 19) return false;` (benchmark)
3. **M2 (схема)** — добавить `if (target.protocol !== 'https:') return 403;` в `handleProxy`.

## Артефакты

- `test/chaos.test.js` — 22 теста, 6 suites, 0 fail, 0 skip. Создан.
- `CHAOS_RETTEST.md` — настоящий отчёт. Создан.
- `server.js`, `test/server.test.js`, `ios/patch-macho.js` — НЕ правились.
- Git-коммитов не производилось.
