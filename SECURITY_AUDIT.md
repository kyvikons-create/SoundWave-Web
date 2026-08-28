# Security Audit — SoundWave

Аудит выполнен без изменения исходного кода, без запуска сервера и без сетевых запросов.
Проанализированы: `server.js` (176 строк), `index.html` (2093 строки), `ios/app.m` (204 строки),
`ios/make-ipa.js` (33 строки), а также `ios/Info.plist`, `ios/shim.h`.

Уровни: **Critical** (RCE/SSRF произвольным хостом/утечка приватных секретов),
**High** (открытый прокси/абуз пользователя), **Medium** (ограниченный SSRF/XSS-френдли),
**Low** (информационное/defense-in-depth).

---

## Критические (Critical)

Критических уязвимостей, позволяющих RCE, arbitrary-host SSRF или утечку приватных секретов
с сервера, не обнаружено. Сервер `server.js` не содержит захардкоженных client_id, токенов
или паролей — секретов на стороне сервера нет.

---

## Высокие (High)

### H-1. Открытый прокси к SoundCloud: CORS `*` + биндинг `0.0.0.0` + без аутентификации

- **Файл, строки:** `server.js:154` (`.listen(PORT, '0.0.0.0', ...)`), `server.js:68` и `server.js:94`
  (`'Access-Control-Allow-Origin': '*'`), `server.js:111-114` (ping без auth).
- **Описание:** Сервер слушает на всех интерфейсах без какой-либо аутентификации и выставляет
  `Access-Control-Allow-Origin: *` на ВСЕ ответы эндпоинта `/sc`. Любой сайт, открытый
  пользователем в браузере, может сделать `fetch('http://localhost:3000/sc?url=...')` и
  прочитать ответ (ACAO `*` разрешает кросс-origin чтение). Любое устройство в той же LAN
  может то же самое через `http://<LAN-IP>:3000/sc?...`.
- **Вектор атаки:**
  1. Жертва запускает `node server.js` (порт 3000, `0.0.0.0`).
  2. Злой сайт делает `fetch('http://localhost:3000/sc?url=' + encodeURIComponent('https://soundcloud.com/'))`,
     получает HTML soundcloud.com, извлекает из него `client_id` SoundCloud (через тот же прокси
     дотягиваясь до `https://a-v2.sndcdn.com/assets/*.js`).
  3. Далее злой сайт гоняет запросы к `https://api-v2.soundcloud.com/...?client_id=...` через
     прокси жертвы — абуз API SoundCloud с IP-адреса жертвы (возможен бан IP-адреса жертвы,
     rate-limit эскалация, скрейпинг).
  4. Дополнительно `/sc?ping=1` — удобный маяк для fingerprinting: любой сайт может
     детектировать, что у жертвы запущен SoundWave (`fetch('http://localhost:3000/sc?ping=1')`).
- **Severity:** High. Blast radius ограничен хостами `soundcloud.com`/`sndcdn.com` (не произвольный
  прокси), но абуз API и fingerprinting реальны.
- **Фикс:**
  ```js
  // server.js — слушать только localhost:
  }).listen(PORT, '127.0.0.1', () => { ... });

  // Ограничить CORS только доверенным origin (или вообще не выставлять для /sc):
  const ALLOWED_ORIGIN = 'http://localhost:' + PORT;
  function corsHeader(req){
    const o = req.headers.origin;
    return (o && (o === ALLOWED_ORIGIN || o.startsWith('http://localhost:') || o.startsWith('http://127.0.0.1:')))
      ? o : null;
  }
  // в handleProxy / proxyViaNode / proxyViaCurl:
  const ao = corsHeader(req);
  const h = {};
  if (ao) h['Access-Control-Allow-Origin'] = ao;
  if (ao) h['Vary'] = 'Origin';
  // убрать ping-маяк или отвечать на него только для доверенного Origin.
  ```

### H-2. Утечка `client_id` SoundCloud сторонним CORS-прокси

- **Файл, строки:** `index.html:605-610` (`wrapUrl`, `corsproxy.io`/`allorigins.win`),
  `index.html:653-656` (`apiGet` подставляет `client_id` в query), `index.html:615-633` (`rawFetch`).
- **Описание:** Когда локальный прокси недоступен и `window.__swNativeFetch` нет, `rawFetch`
  поочерёдно пытается `direct`, затем `https://corsproxy.io/?url=<...>`, затем
  `https://api.allorigins.win/raw?url=<...>`. В URL, передаваемом этим прокси, уже лежит
  `client_id` SoundCloud: `https://api-v2.soundcloud.com/search/tracks?q=...&client_id=...`.
  Таким образом ключ пользователя уезжает на серверы `corsproxy.io` и `allorigins.win` в query-string
  (логируется ими).
- **Вектор атаки:** Пассивная утечка credentials третьим лицам; ключ может быть использован для
  абуза API от имени пользователя/ключа. Усугубляется тем, что `client_id` SoundCloud, будучи
  «полу-публичным», всё же персонален и при абузе ведёт к его инвалидации.
- **Severity:** High (источник — `index.html`, сервер тут ни при чём).
- **Фикс:**
  ```js
  // Не пускать чужие CORS-прокси для запросов, содержащих client_id:
  function wrapUrl(t, url){
    if (t === 'local') return '/sc?url=' + encodeURIComponent(url);
    // p1/p2 оставить ТОЛЬКО для запросов БЕЗ client_id (например, скрейпинг soundcloud.com):
    if (t === 'p1' || t === 'p2') {
      if (/[?&]client_id=/.test(url)) return url; // fallback на direct, без утечки ключа
    }
    return url;
  }
  // Либо отделять «анонимные» запросы (HTML/asset скрейп) от «авторизованных» (api-v2) и
  // гонять последние исключительно через локальный/нативный транспорт.
  ```

---

## Средние (Medium)

### M-1. Нативный сетевой мост `__swNativeFetch` без валидации URL (webview-SSRF)

- **Файл, строки:** `ios/app.m:77-94` (обработчик `userContentController:didReceiveScriptMessage:`,
  разбор `u`/`url`), `ios/app.m:86` (`NSURL URLWithString:` без фильтра), `ios/app.m:89-93`
  (создание запроса и `resume`).
- **Описание:** JS в WKWebView вызывает `window.__swNativeFetch(u)` с произвольным `u`. Нативный
  код строит `NSURLRequest` из `u` без какой-либо проверки хоста/схемы и выполняет его через
  `NSURLSession`. Если в вебвью возникнет XSS (см. M-3, L-2), злой JS сможет через нативный мост
  ходить на ЛЮБЫЕ хосты (в т.ч. внутренние IP, метаданные облака `http://169.254.169.254/`),
  минуя CORS вебвью.
- **Смягчение:** По умолчанию iOS App Transport Security требует HTTPS, поэтому `http://169.254...`
  будет заблокирован ATS (если не заданы `NSAllowsArbitraryLoads` — в `Info.plist` их нет, см. `ios/Info.plist`).
  Это существенно ограничивает вектор: остаются только HTTPS-хосты с валидным сертификатом.
- **Вектор атаки:** XSS в вебвью → `__swNativeFetch('https://внутренний-сервис/...')` → чтение ответа,
  доступного по HTTPS. Требует предварительного XSS.
- **Severity:** Medium.
- **Фикс:**
  ```objc
  // В userContentController:didReceiveScriptMessage: — валидировать хост:
  id host = ((msid1)SW_SEND)(url, SEL_("host"));
  const char *h = ((msidc)SW_SEND)(host, SEL_("UTF8String")); // если есть accessor
  // либо через NSURL scheme/host: разрешить только soundcloud.com / sndcdn.com / lrclib.net / genius.com
  // и отвергать private/loopback диапазонов (10.0.0.0/8, 172.16/12, 192.168/16, 127/8, 169.254/16).
  // При неразрешённом хосте — возвращать в JS {err:'blocked'}.
  ```

### M-2. Отсутствие Content-Security-Policy (XSS-friendly)

- **Файл, строки:** `index.html:1-16` (блок `<head>` без CSP), инлайн `<script>` (`index.html:526`)
  и инлайн `<style>` (`index.html:16`), инлайн-обработчики `onerror=` (`index.html:972`, `997`, `1078`,
  `1443`, `1741`).
- **Описание:** Ни meta-CSP, ни серверных CSP-заголовков (`server.js:142-147` не выставляет
  `Content-Security-Policy`) нет. Любая XSS-дыра немедленно превращается в full RCE-эквивалент
  в контексте страницы (доступ к localStorage с `client_id`, вызов нативного моста, etc.).
- **Вектор атаки:** Найдя любую инъекцию в innerHTML (см. L-2), атакующий исполняет произвольный JS
  без ограничений.
- **Severity:** Medium (defense-in-depth; сам по себе не эксплуатируется, но снимает последний
  барьер).
- **Фикс:**
  ```html
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; img-src 'self' data: https://*.sndcdn.com https://*.soundcloud.com https://i1.sndcdn.com; media-src 'self' https://*.sndcdn.com https://*.soundcloud.com blob:; connect-src 'self' https://api-v2.soundcloud.com https://*.soundcloud.com https://*.sndcdn.com https://lrclib.net https://genius.com https://api.lyrics.ovh; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
  ```
  Плюс в `server.js` добавить `Content-Security-Policy` к статике. Инлайн `onerror=` заменить на
  `addEventListener('error', ...)`.

### M-3. Экспорт настроек/данных из localStorage через `Object.assign` из непроверенной строки

- **Файл, строки:** `index.html:1820-1838` (импорт), `index.html:1833` (`Object.assign(state, j.settings)`),
  `index.html:1829-1831` (конкатенация массивов `likes`/`playlists`/`history`).
- **Описание:** Пользователь вставляет в текстовое поле произвольную JSON-строку, которая
  `JSON.parse`'ится и сливается в `state`. Массивы `likes`/`playlists`/`history` конкатенируются
  без санитации полей. Рендер, правда, экранирует (`esc()`), но `Object.assign(state, j.settings)`
  может перезаписать任意 поля `state` неожидаемыми типами/значениями (например, `state.accent`
  строкой с неожиданным содержимым — используется как ключ в `ACCENTS`, падает в `|| ACCENTS.orange`,
  так что не эксплуатируется, но фрагильно).
- **Вектор атаки:** Самоповреждение: пользователь вставляет злой экспорт (из шеринга/буфера) →
  портится состояние; при наличии доп. дыр может стать XSS-вектором через поля, которые где-то
  не экранируются.
- **Severity:** Medium (низкий реальный импакт благодаря `esc()`, но схема небезопасна).
- **Фикс:**
  ```js
  if (j.settings){
    if (typeof j.settings.accent === 'string' && ACCENTS[j.settings.accent]) state.accent = j.settings.accent;
    if (typeof j.settings.amoled === 'boolean') state.amoled = j.settings.amoled;
    if (typeof j.settings.autoRelated === 'boolean') state.autoRelated = j.settings.autoRelated;
    if (typeof j.settings.fullOnly === 'boolean') state.fullOnly = j.settings.fullOnly;
    LS.set('accent', state.accent); LS.set('amoled', state.amoled); applyTheme();
  }
  // Массивы — валидировать структуру каждого элемента (id — число, title/artist — строки):
  const norm = arr => Array.isArray(arr) ? arr.filter(x => x && typeof x.id === 'number') : [];
  ```

---

## Низкие (Low) / информационные

### L-1. Захардкоженный `client_id` (FALLBACK_CID) в `index.html`, попадает в IPA

- **Файл, строки:** `index.html:597` (`const FALLBACK_CID = 'UMY1dzQ68n2QbCuypNe8JOivmV2FO2Ep';`),
  `index.html:598` (`let cid = LS.get('cid', null) || FALLBACK_CID;`), `index.html:651` (`setCid`),
  `ios/make-ipa.js:18` (`fs.copyFileSync(...'index.html', .../www/index.html)`).
- **Описание:** В клиентском HTML зашит фолбэк-`client_id` SoundCloud. Он же копируется в бандл
  IPA (`make-ipa.js:18`) и, следовательно, доступен в бинарнике/бандле (достаточно `unzip` и
  прочитать `www/index.html`). В `ios/app.m` секретов нет (только UA-строка и JS-мост), в
  `ios/Info.plist` — только `com.soundwave.app`, в `ios/shim.h` — только заголовки.
- **Оценка:** `client_id` SoundCloud — полу-публичный ключ (он же лежит в публичных JS-бандлах
  SoundCloud), поэтому severity Low. Но как «захардкоженный секрет в исходнике/бандле» — находка
  валидна.
- **Фикс:** Не зашивать фолбэк-ключ; при первом запуске вызывать `discoverCid()` (он уже есть,
  `index.html:637-650`) и хранить результат только в `localStorage`. Если фолбэк нужен — вынести
  в отдельный `config.js`, игнорируемый в публичных репозиториях.

### L-2. Неэкранированный `t.link` в `innerHTML` (shareCard)

- **Файл, строки:** `index.html:1571` (`<p class="note">${isNative ? '' : '...'}${t.link || ''}</p>`),
  контекст `index.html:1564-1571` (`openSheet('Карточка трека', ...)`).
- **Описание:** В шаблон карточки трека `t.link` ( = `permalink_url` из API SoundCloud) вставляется
  в innerHTML без `esc()`. Везде_else_ API-данные экранируются (`trackRow:974`, `openArtist:1717`,
  `renderPlRows:1079` и т.д. — используется `esc()`). Здесь — пропуск.
- **Вектор атаки:** Если SoundCloud когда-либо вернёт `permalink_url` с HTML/`"` (крайне
  маловероятно — это всегда `https://soundcloud.com/...`), возможна XSS. Severity Low.
- **Фикс:**
  ```js
  `<p class="note">${isNative ? '' : '...'}${esc(t.link || '')}</p>`
  ```

### L-3. Проверка `file.startsWith(ROOT)` без trailing-разделителя (latent path-traversal)

- **Файл, строки:** `server.js:138-139` (`path.join(ROOT, p)` и `if (!file.startsWith(ROOT))`).
- **Описание:** `ROOT = __dirname` без завершающего `\`. Проверка префикса без разделителя в
  принципе подвержена коллизии «sibling с тем же префиксом» (если бы существовал каталог
  `...\soundwave-evil`, строка `...\soundwave` была бы его префиксом). **Однако** в данном коде
  это не эксплуатируется: `new URL().pathname` нормализует `..` (см. positive F-1), а
  процент-кодированные `%2e%2e` после `decodeURIComponent` дают `..`, который `path.join`
  уводит ВЫШЕ `ROOT` — и проверка `startsWith(ROOT)` корректно его отсекает (403). Двойное
  кодирование (`%252e`) не работает (единственный `decodeURIComponent` даёт `%2f`, не разделитель).
- **Severity:** Low (latent, не эксплуатируется).
- **Фикс:**
  ```js
  const ROOT = path.join(__dirname, path.sep); // trailing separator
  // либо, надёжнее:
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
  ```

### L-4. curl-fallback может идти по `http://` (неконсистентное «HTTPS-only»)

- **Файл, строки:** `server.js:82` (`args.push(target.href)`), `server.js:80` (`--resolve target.hostname:443:ip`).
- **Описание:** `proxyViaNode` всегда использует `https.get` (port 443), форсируя HTTPS. Но
  `proxyViaCurl` подставляет `target.href` как есть: если клиент передал `url=http://soundcloud.com/...`,
  curl пойдёт по plain HTTP (port 80), а `--resolve ...:443:...` к HTTP-запросу не применится.
  Ограничения хоста остаются (только soundcloud.com/sndcdn.com), реального SSRF нет, но
  «гарантия HTTPS» нарушается.
- **Severity:** Low.
- **Фикс:** в `handleProxy` нормализовать схему: `if (target.protocol !== 'https:') target = new URL('https:' + target.href.slice(target.protocol.length));`

### L-5. Отсутствие лимита на размер `url`-параметра (minor DoS)

- **Файл, строки:** `server.js:117` (`new URL(u.searchParams.get('url'))`).
- **Описание:** Принимается URL произвольной длины; `new URL` + последующий `fetch`/`curl` на
  soundcloud.com с гигантским path — минимальный вектор исчерпания CPU/памяти на парсинге.
- **Severity:** Low.
- **Фикс:** `const raw = u.searchParams.get('url') || ''; if (raw.length > 2048) { res.writeHead(414); res.end('url too long'); return; }`

### L-6. Детектируемость локального сервера (fingerprinting)

- **Файл, строки:** `server.js:111-114` (`/sc?ping=1` → `{"ok":true}` с `ACAO:*`).
- **Описание:** Любой сайт может однозначно определить, что у пользователя запущен SoundWave,
  запросом `fetch('http://localhost:3000/sc?ping=1')` (ответ читается кросс-origin благодаря
  `ACAO:*`). Это часть проблемы H-1, вынесена отдельно как Low-вектор для fingerprinting.
- **Severity:** Low.
- **Фикс:** см. H-1 (убрать `ACAO:*`, отвечать на ping только для доверенного Origin или убрать ping).

---

## Что безопасно (positive findings)

- **F-1. `HOST_OK` корректно анкорен `^...$`** (`server.js:28`): суффикс-атаки вида
  `soundcloud.com.evil.com` НЕ проходят — строка обязана ЗАКАНЧИВАТЬСя на `soundcloud.com`/`sndcdn.com`.
  IDN/кириллица (`soundсloud.com` с кириллическим `с`) — `new URL().hostname` отдаёт punycode
  (`xn--...`), который не оканчивается на `soundcloud.com` → отвергается. Схемы `file:`,
  `javascript:`, `data:` дают пустой `hostname` → отвергаются. IP-литерал
  `http://169.254.169.254/` не оканчивается на нужный хост → отвергается. **SSRF на произвольный
  хост через `/sc?url=` отсутствует.**
- **F-2. URL-парсер защищает path и Range от CRLF-инъекции:** `new URL()` перкодирует C0-control
  в pathname в `%0D%0A` (нет request smuggling в `target.pathname+target.search`); входной
  `Range`-заголовок проходит через HTTP-парсер Node, который терминирует заголовки на `\r\n`
  (нет инъекции в upstream-заголовки).
- **F-3. TLS-валидация блокирует DNS-rebinding SSRF:** и `proxyViaNode` (`https.get` с
  `servername`), и `proxyViaCurl` (`curl` с дефолтной проверкой сертификата) проверяют сертификат
  upstream против `target.hostname`. Даже если DoH (`resolveHost`, `server.js:32-51`) вернёт
  внутренний IP для `soundcloud.com`, TLS-рукопожатие с внутренним сервисом упадёт (нет валидного
  сертификата для `soundcloud.com`). DoH при этом обходит потенциально отравленный системный DNS
  (как и задумано). Кэш DoH (`dohCache`) ключуется по хосту с TTL 10 мин (`server.js:31-52`).
- **F-4. Whitelist заголовков ответа:** прокси форвардит upstream'у только `content-type,
  content-length, content-range, accept-ranges` (`server.js:69`, `server.js:99`). `Set-Cookie`,
  `Location`, `Server` и прочее НЕ пробрасываются — нет утечки cookies/внутренних заголовков
  SoundCloud и нет open-redirect через проксированный `Location`.
- **F-5. Сервер не содержит секретов и не логирует запросы:** в `server.js` нет `client_id`,
  токенов, паролей; `console.log` печатает только стартовую плашку (`server.js:155-171`) —
  URL/параметры/ключи в логи не попадают.
- **F-6. Нет `eval`/`Function`/динамического кодогенерации в `index.html`:** весь JS — статический
  инлайн-скрипт; нативный мост `webkit.messageHandlers.sw.postMessage` передаёт JSON-объекты,
  ответ возвращается через `window.__swRecv(<JSON>)` (`ios/app.m:136-137`), где JSON сериализован
  через `NSJSONSerialization` (экранирование корректно) — инъекции в `evaluateJavaScript` нет.
- **F-7. `esc()` применяется последовательно к API-данным в `innerHTML`:** `trackRow`
  (`index.html:972-975`), `renderPlRows` (`1078-1079`), `openArtist` (`1715-1720`),
  `openSCPlaylist` (`1741`), `renderQueue` (`1443-1444`), `openStats` (`1803`), `emptyState`
  (`967`). Исключение — единственный `t.link` (L-2).
- **F-8. Лирика с Genius парсится безопасно:** HTML теги вырезаются (`/<[^>]+>/g`,
  `index.html:1912`), сущности раскодируются вручную, а итог перед вставкой в DOM проходит через
  `esc()` (`index.html:1937`, `1940`) — XSS через подставленный Genius-контент исключён.
- **F-9. iOS App Transport Security включён дефолтом** (`ios/Info.plist` не содержит
  `NSAppTransportServices`/`NSAllowsArbitraryLoads`) — нативный `NSURLSession` моста (M-1) ходит
  только по HTTPS, что резко сужает webview-SSRF.
- **F-10. `ios/app.m`, `ios/Info.plist`, `ios/shim.h`, `ios/make-ipa.js` не содержат секретов:**
  только UA-строка и JS-мост. Единственное, что попадает в бандл IPA — `index.html` с
  `FALLBACK_CID` (L-1).

---

## Сводка

| Уровень | Кол-во | ID |
|---|---|---|
| Critical | 0 | — |
| High | 2 | H-1, H-2 |
| Medium | 3 | M-1, M-2, M-3 |
| Low | 6 | L-1 … L-6 |

Главные приоритеты: закрыть H-1 (CORS/`0.0.0.0`/auth) и H-2 (утечка `client_id` сторонним
CORS-прокси), затем M-1/M-2 (нативный мост + CSP).
