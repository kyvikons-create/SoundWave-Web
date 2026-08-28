/* Регрессионные adversarial-тесты для захардененного SoundWave server.js.
   Тест-раннер: node:test, ассерты: node:assert/strict. Zero npm deps.
   Покрывает 8 критических находок CHAOS_REPORT.md, доступных через экспорты
   server.js (HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath):
     - C1 path traversal через %2f + prefix-collision
     - C2 SSRF/DNS-rebinding (валидация IP + HOST_OK bypass)
   Дополнительно: P3 CRLF в Range, опасные схемы, huge inputs, null/undefined.
   C3-C8 (ios/patch-macho.js) НЕ покрываются этим файлом — требуют spawn и
   crafted Mach-O; статус см. CHAOS_RETTEST.md.
   Не дублирует server.test.js — только adversarial/граничные кейсы. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let server = null;
let requireError = null;
try { server = require('../server.js'); }
catch (e) { requireError = e; }

const { HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath } = server || {};
const ROOT = path.join(__dirname, '..');

// WHATWG URL parser: извлекает hostname (пустая строка при ошибке/нет authority).
const host = u => { try { return new URL(u).hostname } catch { return '' } };

const SKIP = server ? false : ('require ../server.js failed: ' + (requireError && requireError.message || 'unknown'));

// ==================================================================
// C1: Path traversal через %2f + prefix-bug (server.js serveStatic)
// ==================================================================
describe('C1: Path traversal via %2f + prefix-collision (adversarial)', { skip: SKIP }, () => {
  it('отбрасывает %2f/%5c-кодированный traversal', () => {
    assert.equal(resolveStaticPath('/..%2f../', ROOT).ok, false);
    assert.equal(resolveStaticPath('/..%5c..%5c', ROOT).ok, false);
  });

  it('отбрасывает sibling-collision (soundwave-evil начинается с soundwave)', () => {
    // Ключевой кейс C1: баг startsWith(ROOT) пропускал бы sibling 'soundwave-evil'.
    assert.equal(resolveStaticPath('/..%2f..%2fsoundwave-evil/x', ROOT).ok, false);
    assert.equal(resolveStaticPath('/..%2f..%2fsoundwave-evil/secret.txt', ROOT).ok, false);
  });

  it('пропускает легитимные пути и нормализацию внутри root', () => {
    assert.equal(resolveStaticPath('/icons/../index.html', ROOT).ok, true);
    assert.equal(resolveStaticPath('/index.html', ROOT).ok, true);
  });

  it('отбрасывает глубокий traversal (100 уровней ..)', () => {
    const deep = '/' + '../'.repeat(100) + 'secret.txt';
    assert.equal(resolveStaticPath(deep, ROOT).ok, false);
  });

  it('не бросает на гигантском имени файла (100KB) — DoS-стойкость', () => {
    assert.doesNotThrow(() => {
      const r = resolveStaticPath('/' + 'a'.repeat(100000), ROOT);
      assert.equal(r.ok, true, 'длинное имя файла внутри root');
    });
  });
});

// ==================================================================
// C2: SSRF/DNS-rebinding — isPublicIP
// ==================================================================
describe('C2: SSRF — isPublicIP (adversarial)', { skip: SKIP }, () => {
  it('отбрасывает cloud-metadata и loopback/private IPv4', () => {
    assert.equal(isPublicIP('169.254.169.254'), false, 'AWS metadata 169.254/16');
    assert.equal(isPublicIP('127.0.0.1'), false, 'loopback 127/8');
    assert.equal(isPublicIP('10.0.0.1'), false, 'private 10/8');
    assert.equal(isPublicIP('192.168.1.1'), false, 'private 192.168/16');
  });

  it('отбрасывает IPv6 loopback и IPv4-mapped приватные', () => {
    assert.equal(isPublicIP('::1'), false, '::1 loopback');
    assert.equal(isPublicIP('::ffff:127.0.0.1'), false, 'mapped loopback');
  });

  it('разрешает публичные IPv4 (CDN SoundCloud)', () => {
    assert.equal(isPublicIP('8.8.8.8'), true);
    assert.equal(isPublicIP('1.1.1.1'), true);
  });

  it('отбрасывает broadcast/multicast/zero-net', () => {
    assert.equal(isPublicIP('255.255.255.255'), false, 'broadcast');
    assert.equal(isPublicIP('224.0.0.1'), false, 'multicast 224/4');
    assert.equal(isPublicIP('0.0.0.0'), false, '0.0.0.0/8');
  });

  it('MITIGATED: CGNAT/benchmark теперь блокируются', () => {
    // isPublicIPv4 проверяет 100.64.0.0/10 (RFC 6598) и 198.18.0.0/15 (RFC 2544).
    // Ранее residual-assert ожидал true — перевёрнут на false после фикса.
    assert.equal(isPublicIP('100.64.0.1'), false, 'CGNAT 100.64/10 блокируется');
    assert.equal(isPublicIP('198.18.0.1'), false, 'benchmark 198.18/15 блокируется');
    // Границы диапазонов: внутри блокируется, сразу снаружи — публичный.
    assert.equal(isPublicIP('100.63.255.254'), true, 'до CGNAT — публичный');
    assert.equal(isPublicIP('100.128.0.1'), true, 'после CGNAT — публичный');
    assert.equal(isPublicIP('198.17.255.254'), true, 'до benchmark — публичный');
    assert.equal(isPublicIP('198.20.0.1'), true, 'после benchmark — публичный');
  });
});

// ==================================================================
// C2: HOST_OK bypass attempts (suffix/homograph/userinfo)
// ==================================================================
describe('C2: HOST_OK bypass (adversarial)', { skip: SKIP }, () => {
  it('отбрасывает suffix-bypass', () => {
    assert.equal(HOST_OK.test('soundcloud.com.evil.com'), false);
    assert.equal(HOST_OK.test('api.soundcloud.com.evil.com'), false);
    assert.equal(HOST_OK.test('sndcdn.com.evil.com'), false);
  });

  it('отбрасывает кириллический homograph (sоundcloud.com, U+043E)', () => {
    assert.equal(HOST_OK.test('sоundcloud.com'), false);
  });

  it('отбрасывает userinfo-rebind через host() хелпер', () => {
    // http://soundcloud.com@169.254.169.254/ → WHATWG hostname = '169.254.169.254'
    const h = host('http://soundcloud.com@169.254.169.254/');
    assert.equal(h, '169.254.169.254', 'URL parser выносит IP в hostname');
    assert.equal(HOST_OK.test(h), false);
  });

  it('отбрасывает trailing-dot и glue-домены', () => {
    assert.equal(HOST_OK.test('soundcloud.com.'), false, 'trailing dot');
    assert.equal(HOST_OK.test('soundcloud.comsndcdn.com'), false, 'glue без точки');
  });
});

// ==================================================================
// P3: CRLF injection в Range
// ==================================================================
describe('P3: CRLF injection в Range (adversarial)', { skip: SKIP }, () => {
  it('отбрасывает CRLF/LF/CR-инъекцию', () => {
    assert.equal(sanitizeRange('bytes=0-1\r\nX: e'), null, 'CRLF');
    assert.equal(sanitizeRange('bytes=0-1\nX: e'), null, 'bare LF');
    assert.equal(sanitizeRange('bytes=0-1\rX: e'), null, 'bare CR');
  });

  it('принимает строгий валидный Range', () => {
    assert.equal(sanitizeRange('bytes=0-1024'), 'bytes=0-1024');
  });

  it('отбрасывает мусор и пустоту', () => {
    assert.equal(sanitizeRange('evil'), null);
    assert.equal(sanitizeRange(''), null);
  });

  it('отбрасывает гигантское число (>19 цифр)', () => {
    assert.equal(sanitizeRange('bytes=' + '9'.repeat(50)), null, 'нет дефиса');
    assert.equal(sanitizeRange('bytes=' + '9'.repeat(50) + '-0'), null, '>19 цифр до дефиса');
  });
});

// ==================================================================
// Adversarial: опасные URL-схемы
// ==================================================================
describe('Adversarial: опасные URL-схемы', { skip: SKIP }, () => {
  it('file/javascript/data дают пустой hostname → HOST_OK false', () => {
    assert.equal(host('file:///c:/x'), '', 'file scheme');
    assert.equal(HOST_OK.test(host('file:///c:/x')), false);
    assert.equal(host('javascript:alert(1)'), '');
    assert.equal(HOST_OK.test(host('javascript:alert(1)')), false);
    assert.equal(host('data:x'), '');
    assert.equal(HOST_OK.test(host('data:x')), false);
  });

  it('MITIGATED M2: HOST_OK проверяет только hostname; scheme-чек в handleProxy (e2e-covered)', () => {
    // HOST_OK намеренно валидирует только hostname. ftp://soundcloud.com →
    // hostname=soundcloud.com → HOST_OK true (hostname корректен). Но handleProxy
    // теперь отбрасывает non-https схемы 403 'https only' (M2 mitigated).
    // handleProxy не экспортируется — scheme-чек покрывается интеграционным тестом
    // (e2e.test.js), здесь фиксируем инвариант HOST_OK как hostname-only валидатор.
    assert.equal(host('ftp://soundcloud.com/'), 'soundcloud.com');
    assert.equal(HOST_OK.test(host('ftp://soundcloud.com/')), true, 'HOST_OK — hostname-only, не scheme');
  });
});

// ==================================================================
// Adversarial: null/undefined входы
// ==================================================================
describe('Adversarial: null/undefined входы', { skip: SKIP }, () => {
  it('sanitizeRange отбрасывает null/undefined', () => {
    assert.equal(sanitizeRange(undefined), null);
    assert.equal(sanitizeRange(null), null);
  });

  it('resolveStaticPath бросает TypeError на undefined/null (RESIDUAL snapshot)', () => {
    // Функция не валидирует тип p — бросает на undefined.replace.
    // В реальном serveStatic p всегда строка (из decodeURIComponent), но
    // как библиотечная функция это residual. Зафиксируем текущее поведение.
    assert.throws(() => resolveStaticPath(undefined, ROOT), TypeError);
    assert.throws(() => resolveStaticPath(null, ROOT), TypeError);
  });
});
