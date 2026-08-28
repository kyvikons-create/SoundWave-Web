/* Unit-тесты для SoundWave server.js.
   Тест-раннер: node:test, ассерты: node:assert/strict.
   Философия: zero npm deps — только встроенные модули Node.
   Покрывает: HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath. */
const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath } = require('../server.js');

const ROOT = path.join(__dirname, '..');

// ==================================================================
// HOST_OK — whitelist доменов SoundCloud
// ==================================================================
describe('HOST_OK', () => {
  it('разрешает легитимные хосты SoundCloud', () => {
    assert.equal(HOST_OK.test('api-v2.soundcloud.com'), true);
    assert.equal(HOST_OK.test('soundcloud.com'), true);
    assert.equal(HOST_OK.test('sndcdn.com'), true);
    assert.equal(HOST_OK.test('a.b.sndcdn.com'), true);
  });

  it('отвергает суффикс-атаку (soundcloud.com.evil.com)', () => {
    assert.equal(HOST_OK.test('soundcloud.com.evil.com'), false);
  });

  it('отвергает кириллический homograph (sоundcloud.com с U+043E)', () => {
    assert.equal(HOST_OK.test('sоundcloud.com'), false);
  });

  it('отвергает произвольный хост (evil.com)', () => {
    assert.equal(HOST_OK.test('evil.com'), false);
  });

  it('отвергает IP-литерал (169.254.169.254)', () => {
    assert.equal(HOST_OK.test('169.254.169.254'), false);
  });

  it('отвергает пустую строку', () => {
    assert.equal(HOST_OK.test(''), false);
  });

  it('отвергает userinfo-rebind: hostname после URL-парсинга = IP', () => {
    // http://soundcloud.com@169.254.169.254 → WHATWG parser отбрасывает userinfo до '@'
    const hostname = new URL('http://soundcloud.com@169.254.169.254').hostname;
    assert.equal(hostname, '169.254.169.254', 'URL parser должен вынести IP в hostname');
    assert.equal(HOST_OK.test(hostname), false);
  });
});

// ==================================================================
// isPublicIP — защита от SSRF/DNS-rebinding
// ==================================================================
describe('isPublicIP', () => {
  it('отвергает IPv4 loopback/private/link-local/reserved/multicast', () => {
    assert.equal(isPublicIP('127.0.0.1'), false, '127/8 loopback');
    assert.equal(isPublicIP('10.0.0.1'), false, '10/8 private');
    assert.equal(isPublicIP('192.168.1.1'), false, '192.168/16 private');
    assert.equal(isPublicIP('169.254.169.254'), false, '169.254/16 link-local (AWS metadata)');
    assert.equal(isPublicIP('172.16.0.1'), false, '172.16/12 private');
    assert.equal(isPublicIP('0.0.0.0'), false, '0.0.0.0/8');
    assert.equal(isPublicIP('224.0.0.1'), false, '224/4 multicast');
  });

  it('отвергает приватные IPv6', () => {
    assert.equal(isPublicIP('::1'), false, '::1 loopback');
    assert.equal(isPublicIP('fe80::1'), false, 'fe80::/10 link-local');
    assert.equal(isPublicIP('fc00::1'), false, 'fc00::/7 unique-local');
  });

  it('отвергает IPv4-mapped IPv6 с приватным v4 (::ffff:127.0.0.1)', () => {
    assert.equal(isPublicIP('::ffff:127.0.0.1'), false);
  });

  it('отвергает CGNAT (100.64/10, RFC 6598) и benchmark (198.18/15, RFC 2544)', () => {
    assert.equal(isPublicIP('100.64.0.1'), false, 'CGNAT 100.64.0.0/10');
    assert.equal(isPublicIP('100.127.255.254'), false, 'верхняя граница CGNAT');
    assert.equal(isPublicIP('100.128.0.1'), true, 'после CGNAT — публичный');
    assert.equal(isPublicIP('198.18.0.1'), false, 'benchmark 198.18.0.0/15');
    assert.equal(isPublicIP('198.19.255.254'), false, 'верхняя граница benchmark');
    assert.equal(isPublicIP('198.20.0.1'), true, 'после benchmark — публичный');
  });

  it('разрешает публичные IPv4 (CDN SoundCloud)', () => {
    assert.equal(isPublicIP('8.8.8.8'), true);
    assert.equal(isPublicIP('1.1.1.1'), true);
    assert.equal(isPublicIP('104.16.0.1'), true);
  });

  it('разрешает IPv4-mapped IPv6 с публичным v4 (::ffff:8.8.8.8)', () => {
    assert.equal(isPublicIP('::ffff:8.8.8.8'), true);
  });

  it('отвергает невалидный/пустой ввод', () => {
    assert.equal(isPublicIP(null), false);
    assert.equal(isPublicIP(undefined), false);
    assert.equal(isPublicIP(''), false);
    assert.equal(isPublicIP('not-an-ip'), false);
    assert.equal(isPublicIP('999.999.999.999'), false);
  });
});

// ==================================================================
// sanitizeRange — защита от CRLF-инъекции в Range-заголовке
// ==================================================================
describe('sanitizeRange', () => {
  it('принимает валидные Range', () => {
    assert.equal(sanitizeRange('bytes=0-1024'), 'bytes=0-1024');
    assert.equal(sanitizeRange('bytes=0-'), 'bytes=0-');
    assert.equal(sanitizeRange('bytes=-1024'), 'bytes=-1024');
    assert.equal(sanitizeRange('bytes=0-0'), 'bytes=0-0');
  });

  it('отбрасывает CRLF-инъекцию (bytes=0-1\\r\\nX: e)', () => {
    assert.equal(sanitizeRange('bytes=0-1\r\nX: e'), null);
  });

  it('отбрасывает мусор', () => {
    assert.equal(sanitizeRange('evil'), null);
    assert.equal(sanitizeRange(''), null);
    assert.equal(sanitizeRange('bytes=abc-def'), null);
    assert.equal(sanitizeRange('bytes=0-1; inject'), null);
  });

  it('отбрасывает не-строку', () => {
    assert.equal(sanitizeRange(null), null);
    assert.equal(sanitizeRange(undefined), null);
    assert.equal(sanitizeRange(123), null);
  });

  it('ограничивает длину чисел (19 цифр)', () => {
    assert.equal(sanitizeRange('bytes=1234567890123456789-0'), 'bytes=1234567890123456789-0');
    assert.equal(sanitizeRange('bytes=12345678901234567890-0'), null, '20 цифр — слишком много');
  });
});

// ==================================================================
// resolveStaticPath — защита от path traversal в serveStatic
// ==================================================================
describe('resolveStaticPath', () => {
  it('отбрасывает path traversal через %2f (prefix-collision)', () => {
    assert.equal(resolveStaticPath('/..%2f../', ROOT).ok, false);
    assert.equal(resolveStaticPath('/..%5c..%5c', ROOT).ok, false);
    assert.equal(resolveStaticPath('/..%2f..%2fsoundwave-evil/x', ROOT).ok, false);
  });

  it('пропускает легитимные пути внутри root', () => {
    assert.equal(resolveStaticPath('/index.html', ROOT).ok, true);
    assert.equal(resolveStaticPath('/icons/icon-192.png', ROOT).ok, true);
  });

  it('пропускает нормализуемые пути, остающиеся внутри root', () => {
    assert.equal(resolveStaticPath('/icons/../index.html', ROOT).ok, true);
  });

  it('отбрасывает выход за пределы произвольного root', () => {
    // OS-агностичный root (path.relative лексичен — папка не обязана существовать)
    const otherRoot = path.join(os.tmpdir(), 'sw-arbitrary-root-test');
    assert.equal(resolveStaticPath('/', otherRoot).ok, true, '/ → остаётся в root');
    assert.equal(resolveStaticPath('/../../escape.txt', otherRoot).ok, false, '../../escape.txt уходит выше root');
  });

  it('возвращает file-путь для валидных запросов', () => {
    const r = resolveStaticPath('/index.html', ROOT);
    assert.equal(r.ok, true);
    assert.ok(r.file && r.file.length > 0);
  });
});

// ==================================================================
// Дымовой тест: server.js не стартует сервер при require()
// ==================================================================
describe('server.js exports', () => {
  it('экспортирует ровно 4 сущности корректных типов', () => {
    assert.ok(HOST_OK instanceof RegExp, 'HOST_OK должен быть RegExp');
    assert.equal(typeof isPublicIP, 'function');
    assert.equal(typeof sanitizeRange, 'function');
    assert.equal(typeof resolveStaticPath, 'function');
  });

  it('не экспортирует сетевые/прокси-функции (no SSRF surface via require)', () => {
    const mod = require('../server.js');
    const keys = Object.keys(mod);
    assert.deepEqual(keys.sort(), ['HOST_OK', 'isPublicIP', 'resolveStaticPath', 'sanitizeRange'].sort());
  });
});
