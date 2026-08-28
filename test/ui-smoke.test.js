'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');

test('file: index.html существует и читается как текст', () => {
  assert.ok(typeof html === 'string', 'index.html должен быть строкой (utf8)');
  assert.ok(html.length > 0, 'index.html не должен быть пустым');
});

test('структура: <title>SoundWave</title> присутствует', () => {
  assert.match(html, /<title>SoundWave<\/title>/, 'ожидался <title>SoundWave</title>');
});

test('pwa: link rel="manifest" href="manifest.webmanifest"', () => {
  assert.match(
    html,
    /<link[^>]*rel=["']manifest["'][^>]*href=["']manifest\.webmanifest["']/,
    'ожидался link rel="manifest" href="manifest.webmanifest"'
  );
});

test('pwa: упоминается "manifest.webmanifest"', (t) => {
  const n = (html.match(/manifest\.webmanifest/g) || []).length;
  assert.ok(n >= 1, `ожидалось >=1 вхождений manifest.webmanifest, факт ${n}`);
  t.diagnostic(`manifest.webmanifest вхождений: ${n}`);
});

test('pwa: упоминаются "icons/"', (t) => {
  const n = (html.match(/icons\//g) || []).length;
  assert.ok(n >= 1, `ожидалось >=1 вхождений icons/, факт ${n}`);
  t.diagnostic(`icons/ вхождений: ${n}`);
});

test('pwa: meta name="theme-color" содержит #08080d', () => {
  assert.match(
    html,
    /<meta\s+name=["']theme-color["']\s+content=["'][^"']*#08080d[^"']*["']/,
    'ожидался meta theme-color с #08080d'
  );
});

test('pwa: meta apple-mobile-web-app-capable = yes', () => {
  assert.match(
    html,
    /<meta\s+name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']/,
    'ожидался apple-mobile-web-app-capable=yes'
  );
});

test('pwa: apple-touch-icon → icons/icon-180.png', () => {
  assert.match(
    html,
    /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']icons\/icon-180\.png["']/,
    'ожидался apple-touch-icon icons/icon-180.png'
  );
});

test('pwa: icon → icons/icon-192.png', () => {
  assert.match(
    html,
    /<link[^>]*rel=["']icon["'][^>]*href=["']icons\/icon-192\.png["']/,
    'ожидался icon icons/icon-192.png'
  );
});

test('css: переменная --bg:#08080d (с опциональным пробелом)', () => {
  assert.match(
    html,
    /--bg:\s*#08080d/,
    'ожидалось объявление --bg:#08080d'
  );
});

test('css: класс .searchbar присутствует', (t) => {
  const n = (html.match(/searchbar/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 вхождений searchbar, факт ${n}`);
  t.diagnostic(`searchbar вхождений: ${n}`);
});

test('css: класс .chip присутствует', (t) => {
  const n = (html.match(/chip/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 вхождений chip, факт ${n}`);
  t.diagnostic(`chip вхождений: ${n}`);
});

test('css: класс .scroll присутствует', (t) => {
  const n = (html.match(/scroll/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 вхождений scroll, факт ${n}`);
  t.diagnostic(`scroll вхождений: ${n}`);
});

test('hero: класс .hero-t (градиентный заголовок SoundWave)', (t) => {
  const n = (html.match(/\.hero-t\b/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 вхождений .hero-t, факт ${n}`);
  t.diagnostic(`.hero-t вхождений: ${n}`);
});

test('текст: "SoundWave" встречается минимум 2 раза', (t) => {
  const n = (html.match(/SoundWave/g) || []).length;
  assert.ok(n >= 2, `ожидалось >=2 вхождений "SoundWave", факт ${n}`);
  t.diagnostic(`"SoundWave" вхождений: ${n}`);
});

test('baseline: количество eval( == 0 (небезопасный паттерн)', (t) => {
  const n = (html.match(/eval\(/g) || []).length;
  assert.equal(n, 0, `ожидалось 0 вхождений "eval(", факт ${n}`);
  t.diagnostic(`"eval(" вхождений: ${n} (ожидалось 0)`);
});

test('baseline: localStorage присутствует (данные хранятся локально) — инфо', (t) => {
  const n = (html.match(/localStorage/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 вхождений localStorage (локальное хранилище), факт ${n}`);
  t.diagnostic(`localStorage вхождений: ${n} — данные хранятся локально`);
});

test('размер: index.html > 50KB', (t) => {
  const bytes = Buffer.byteLength(html, 'utf8');
  assert.ok(bytes > 50 * 1024, `ожидалось >51200 байт, факт ${bytes}`);
  t.diagnostic(`размер index.html: ${bytes} байт (~${(bytes / 1024).toFixed(1)} KB)`);
});

test('объём: кол-во строк > 1500', (t) => {
  assert.ok(lines.length > 1500, `ожидалось >1500 строк, факт ${lines.length}`);
  t.diagnostic(`строк в index.html: ${lines.length}`);
});
