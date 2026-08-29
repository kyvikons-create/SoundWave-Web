'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.existsSync(path.join(ROOT, 'style.css')) ? fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8') : '';
const js = fs.existsSync(path.join(ROOT, 'app.js')) ? fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') : '';
const bundle = html + '\n' + css + '\n' + js;

test('files: index.html + style.css + app.js существуют (модульная структура)', () => {
  assert.ok(html.length > 0, 'index.html (shell) должен быть непустым');
  assert.ok(css.length > 0, 'style.css должен существовать и быть непустым');
  assert.ok(js.length > 0, 'app.js должен существовать и быть непустым');
});

test('shell: <title>SoundWave</title>', () => {
  assert.match(html, /<title>SoundWave<\/title>/);
});

test('shell: link rel="manifest" href="manifest.webmanifest"', () => {
  assert.match(html, /<link[^>]*rel=["']manifest["'][^>]*href=["']manifest\.webmanifest["']/);
});

test('shell: apple-touch-icon + icon', () => {
  assert.match(html, /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']icons\/icon-180\.png["']/);
  assert.match(html, /<link[^>]*rel=["']icon["'][^>]*href=["']icons\/icon-192\.png["']/);
});

test('shell: meta theme-color #08080d + apple-mobile-web-app-capable', () => {
  assert.match(html, /<meta\s+name=["']theme-color["']\s+content=["'][^"']*#08080d[^"']*["']/);
  assert.match(html, /<meta\s+name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']/);
});

test('shell: links style.css + app.js (modular)', () => {
  assert.match(html, /<link[^>]*rel=["']stylesheet["'][^>]*href=["']style\.css["']/, 'shell должен линковать style.css');
  assert.match(html, /<script[^>]*src=["']app\.js["']/, 'shell должен грузить app.js');
});

test('css: переменная --bg:#08080d (в style.css)', () => {
  assert.match(css, /--bg:\s*#08080d/, 'ожидалось --bg:#08080d в style.css');
});

test('css: классы .searchbar/.chip/.scroll/.hero-t (в style.css)', (t) => {
  assert.ok((css.match(/\.searchbar\b/g) || []).length > 0, '.searchbar в style.css');
  assert.ok((css.match(/\.chip\b/g) || []).length > 0, '.chip в style.css');
  assert.ok((css.match(/\.scroll\b/g) || []).length > 0, '.scroll в style.css');
  assert.ok((css.match(/\.hero-t\b/g) || []).length > 0, '.hero-t в style.css');
  t.diagnostic('css classes present in style.css');
});

test('html: классы searchbar/chip/scroll/hero-t в shell-разметке', (t) => {
  for (const c of ['searchbar', 'chip', 'scroll', 'hero-t']) {
    const n = (html.match(new RegExp(c, 'g')) || []).length;
    assert.ok(n > 0, `ожидалось >0 вхождений ${c} в index.html, факт ${n}`);
  }
});

test('text: "SoundWave" встречается >=2 раза (across bundle)', (t) => {
  const n = (bundle.match(/SoundWave/g) || []).length;
  assert.ok(n >= 2, `ожидалось >=2, факт ${n}`);
  t.diagnostic(`SoundWave вхождений: ${n}`);
});

test('baseline: eval( == 0 (app.js)', (t) => {
  const n = (js.match(/eval\(/g) || []).length;
  assert.equal(n, 0, `ожидалось 0 eval( в app.js, факт ${n}`);
  t.diagnostic(`eval( вхождений в app.js: ${n}`);
});

test('baseline: localStorage в app.js (локальное хранилище)', (t) => {
  const n = (js.match(/localStorage/g) || []).length;
  assert.ok(n > 0, `ожидалось >0 localStorage в app.js, факт ${n}`);
  t.diagnostic(`localStorage вхождений в app.js: ${n}`);
});

test('объём: app.js > 1500 строк (движок+UI в одном модуле)', (t) => {
  const n = js.split('\n').length;
  assert.ok(n > 1500, `ожидалось >1500 строк в app.js, факт ${n}`);
  t.diagnostic(`строк в app.js: ${n}`);
});

test('объём: bundle (html+css+js) > 80KB', (t) => {
  const bytes = Buffer.byteLength(bundle, 'utf8');
  assert.ok(bytes > 80 * 1024, `ожидалось >80KB, факт ${bytes}`);
  t.diagnostic(`bundle размер: ${bytes} байт (~${(bytes / 1024).toFixed(1)} KB)`);
});
