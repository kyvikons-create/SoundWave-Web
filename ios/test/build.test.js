/* Unit-тесты для iOS build-скриптов SoundWave.
   Тест-раннер: node:test, ассерты: node:assert/strict.
   Философия: zero npm deps — только встроенные модули Node. */
const { test, describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const IOS_DIR = 'C:\\Users\\User\\Desktop\\Новая папка (13)\\soundwave\\ios';
const TMP_BASE = 'C:\\Users\\User\\AppData\\Local\\Temp\\opencode';

const tmpDirs = [];
function makeTmp() {
  const dir = path.join(TMP_BASE, `sw-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

// -- Глобальная очистка временных папок после всех тестов ----------
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
});

// -- Хелпер: минимальный валидный 64-битный Mach-O (arm64, execute) --
// Строит Mach-O с LC_BUILD_VERSION (platform=MACOS) и LC_LOAD_DYLIB.
// Объявлён в module-scope, чтобы переиспользовать в нескольких describe.
function buildFakeMachO() {
  const LC_BUILD_VERSION = 0x32;
  const LC_LOAD_DYLIB = 0x0c;
  const buildSize = 24;            // sizeof(build_version_command) без tools
  const dylibName = '/usr/lib/libSystem.B.dylib';
  const nameBytes = Buffer.from(dylibName + '\0', 'latin1'); // 25 байт
  const namePad = (8 - (nameBytes.length % 8)) % 8;          // добиваем до 8
  const nameTotal = nameBytes.length + namePad;             // 32
  const dylibSize = 24 + nameTotal;                          // 56
  const total = 32 + buildSize + dylibSize;                  // 112
  const buf = Buffer.alloc(total);

  // --- mach_header_64 ---
  buf.writeUInt32LE(0xfeedfacf, 0);   // magic MH_MAGIC_64
  buf.writeUInt32LE(0x100000c, 4);     // cputype CPU_TYPE_ARM64
  buf.writeUInt32LE(0, 8);             // cpusubtype
  buf.writeUInt32LE(2, 12);            // filetype MH_EXECUTE
  buf.writeUInt32LE(2, 16);            // ncmds = 2
  buf.writeUInt32LE(buildSize + dylibSize, 20); // sizeofcmds
  buf.writeUInt32LE(0, 24);            // flags
  buf.writeUInt32LE(0, 28);            // reserved

  // --- LC_BUILD_VERSION @ 32 ---
  let off = 32;
  buf.writeUInt32LE(LC_BUILD_VERSION, off + 0);
  buf.writeUInt32LE(buildSize, off + 4);
  buf.writeUInt32LE(1, off + 8);       // platform = 1 (MACOS)
  buf.writeUInt32LE((11 << 16) | 0, off + 12); // minos = 11.0.0
  buf.writeUInt32LE((14 << 16) | 0, off + 16); // sdk = 14.0.0
  buf.writeUInt32LE(0, off + 20);      // ntools

  // --- LC_LOAD_DYLIB @ 56 ---
  off = 32 + buildSize; // 56
  buf.writeUInt32LE(LC_LOAD_DYLIB, off + 0);
  buf.writeUInt32LE(dylibSize, off + 4);
  buf.writeUInt32LE(24, off + 8);      // name offset (внутри cmd)
  buf.writeUInt32LE(0, off + 12);      // timestamp
  buf.writeUInt32LE(0, off + 16);      // current_version
  buf.writeUInt32LE(0, off + 20);      // compatibility_version
  nameBytes.copy(buf, off + 24);
  return buf;
}

// ==================================================================
// 1. gen-tbds.js
// ==================================================================
describe('gen-tbds.js', () => {
  let dir, tbdDir;

  before(() => {
    dir = makeTmp();
    fs.copyFileSync(path.join(IOS_DIR, 'gen-tbds.js'), path.join(dir, 'gen-tbds.js'));
    execFileSync(process.execPath, ['gen-tbds.js'], { cwd: dir, stdio: 'pipe', timeout: 30000 });
    tbdDir = path.join(dir, 'tbd');
  });

  it('создаёт папку tbd/', () => {
    assert.equal(fs.existsSync(tbdDir), true, 'tbd/ не создана');
    const st = fs.statSync(tbdDir);
    assert.equal(st.isDirectory(), true);
  });

  it('генерирует все ожидаемые .tbd файлы', () => {
    // gen-tbds.js (строка 71) добавляет префикс 'lib' к именам, не начинающимся с 'lib'.
    const expected = [
      'libobjc.tbd', 'libSystem.tbd', 'libUIKit.tbd', 'libWebKit.tbd',
      'libFoundation.tbd', 'libCoreFoundation.tbd', 'libdispatch.tbd',
      'libsystem_blocks.tbd', 'libAVFAudio.tbd',
    ];
    const present = fs.readdirSync(tbdDir);
    for (const f of expected) {
      assert.ok(present.includes(f), `отсутствует файл ${f}; есть: ${present.join(', ')}`);
    }
  });

  it('libobjc.tbd содержит ключевые Objective-C runtime символы', () => {
    const c = fs.readFileSync(path.join(tbdDir, 'libobjc.tbd'), 'utf8');
    assert.match(c, /_objc_msgSend/);
    assert.match(c, /_objc_msgSendSuper2/);
    assert.match(c, /_objc_retain/);
    assert.match(c, /_objc_release/);
    assert.match(c, /install-name:\s+'\/usr\/lib\/libobjc\.A\.dylib'/);
  });

  it('libUIKit.tbd содержит _UIApplicationMain и классы UI* (_OBJC_CLASS_$_)', () => {
    const c = fs.readFileSync(path.join(tbdDir, 'libUIKit.tbd'), 'utf8');
    assert.match(c, /_UIApplicationMain/);
    assert.match(c, /_OBJC_CLASS_\$_UIWindow/);
    assert.match(c, /_OBJC_METACLASS_\$_UIView/);
  });

  it('libWebKit.tbd содержит символы WKWebView', () => {
    const c = fs.readFileSync(path.join(tbdDir, 'libWebKit.tbd'), 'utf8');
    assert.match(c, /_OBJC_CLASS_\$_WKWebView/);
    assert.match(c, /_OBJC_METACLASS_\$_WKUserContentController/);
  });

  it('libAVFAudio.tbd содержит _AVAudioSessionCategoryPlayback', () => {
    const c = fs.readFileSync(path.join(tbdDir, 'libAVFAudio.tbd'), 'utf8');
    assert.match(c, /_AVAudioSessionCategoryPlayback/);
    assert.match(c, /_OBJC_CLASS_\$_AVAudioSession/);
  });

  it('libSystem.tbd содержит базовые libc символы', () => {
    const c = fs.readFileSync(path.join(tbdDir, 'libSystem.tbd'), 'utf8');
    assert.match(c, /_malloc/);
    assert.match(c, /_free/);
    assert.match(c, /_memcpy/);
    assert.match(c, /___stack_chk_guard/);
  });

  it('все .tbd файлы содержат tapi-заголовок (tbd-version + install-name)', () => {
    const files = fs.readdirSync(tbdDir).filter(f => f.endsWith('.tbd'));
    assert.ok(files.length >= 9, `ожидалось >=9 tbd-файлов, получилось ${files.length}`);
    for (const f of files) {
      const c = fs.readFileSync(path.join(tbdDir, f), 'utf8');
      assert.match(c, /--- !tapi-tbd/, `${f}: нет tapi-маркера`);
      assert.match(c, /tbd-version:\s+4/, `${f}: нет tbd-version: 4`);
      assert.match(c, /install-name:/, `${f}: нет install-name`);
    }
  });
});

// ==================================================================
// 2. patch-macho.js
// ==================================================================
describe('patch-macho.js', () => {
  it('патчит platform MACOS→IOS, minos→15.0.0, sdk→18.0.0 (write)', () => {
    const dir = makeTmp();
    const file = path.join(dir, 'fake.macho');
    fs.writeFileSync(file, buildFakeMachO());

    const out = execFileSync(process.execPath,
      [path.join(IOS_DIR, 'patch-macho.js'), file, 'write'],
      { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });

    assert.match(out, /пропатчено на platform=IOS minos=15\.0 sdk=18\.0/);

    const buf = fs.readFileSync(file);
    // файл остался валидным Mach-O
    assert.equal(buf.readUInt32LE(0), 0xfeedfacf, 'магия испорчена');

    // LC_BUILD_VERSION @ 32
    const platform = buf.readUInt32LE(32 + 8);
    const minos = buf.readUInt32LE(32 + 12);
    const sdk = buf.readUInt32LE(32 + 16);
    assert.equal(platform, 2, 'platform должен стать 2 (IOS)');
    assert.equal(minos, (15 << 16) | 0, 'minos должен быть 15.0.0');
    assert.equal(sdk, (18 << 16) | 0, 'sdk должен быть 18.0.0');

    // версия как строка
    const v = x => `${x >> 16}.${(x >> 8) & 0xff}.${x & 0xff}`;
    assert.equal(v(minos), '15.0.0');
    assert.equal(v(sdk), '18.0.0');
  });

  it('читает dylib-зависимости (LC_LOAD_DYLIB)', () => {
    const dir = makeTmp();
    const file = path.join(dir, 'fake.macho');
    fs.writeFileSync(file, buildFakeMachO());

    const out = execFileSync(process.execPath,
      [path.join(IOS_DIR, 'patch-macho.js'), file],
      { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });

    assert.match(out, /dylibs:/);
    assert.match(out, /\/usr\/lib\/libSystem\.B\.dylib/);
    // без 'write' файл не должен меняться: platform остаётся MACOS(1)
    const after = fs.readFileSync(file);
    assert.equal(after.readUInt32LE(32 + 8), 1, 'без write platform не должен меняться');
  });

  it('падает с понятной ошибкой на не-Mach-O файле', () => {
    const dir = makeTmp();
    const file = path.join(dir, 'not-macho.txt');
    fs.writeFileSync(file, 'это вообще текст, а не бинарь');

    let err;
    try {
      execFileSync(process.execPath,
        [path.join(IOS_DIR, 'patch-macho.js'), file, 'write'],
        { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'ожидалась ошибка для не-Mach-O файла');
    assert.ok(err.status !== 0 && err.code !== 0, 'ожидался ненулевой exit code');
    const stderr = err.stderr || '';
    assert.match(stderr, /не Mach-O 64 LE/);
  });
});

// ==================================================================
// 3. make-ipa.js — структурный smoke-test (БЕЗ запуска)
// ==================================================================
describe('make-ipa.js smoke', () => {
  let src;

  before(() => {
    src = fs.readFileSync(path.join(IOS_DIR, 'make-ipa.js'), 'utf8');
  });

  it('файл существует и непустой', () => {
    assert.ok(src.length > 0, 'make-ipa.js пуст или не читается');
  });

  it('ссылается на Payload/SoundWave.app структуру', () => {
    assert.match(src, /Payload/);
    assert.match(src, /SoundWave\.app/);
  });

  it('копирует www/index.html из родительского каталога', () => {
    assert.match(src, /www/);
    assert.match(src, /index\.html/);
    assert.match(src, /\.\.['"]?,\s*['"]index\.html/);
  });

  it('собирает SoundWave.ipa и SoundWave.tipa', () => {
    assert.match(src, /SoundWave\.ipa/);
    assert.match(src, /SoundWave\.tipa/);
  });

  it('проверяет zip-магию "PK"', () => {
    assert.match(src, /'PK'/);
  });

  it('использует tar --format zip для упаковки', () => {
    assert.match(src, /--format/);
    assert.match(src, /zip/);
  });
});

// ==================================================================
// 4. patch-macho.js error handling (C3/C4/C5) — spawn-регрессия
//    Раньше residual: фикс в коде требует регрессионного покрытия.
//    Запускаем patch-macho.js как child_process.spawnSync (НЕ throw
//    на ненулевом exit, в отличие от execFileSync) — проверяем exit
//    code и stderr. Используем process.execPath (абсолютный путь к
//    node) + абсолютный scriptPath, args-массив — обход шелл-сплита
//    и проблем с пробелами в «Новая папка (13)».
// ==================================================================
describe('patch-macho.js error handling (C3/C4/C5)', () => {
  const scriptPath = path.join(IOS_DIR, 'patch-macho.js');
  let tmpDir;

  before(() => {
    tmpDir = makeTmp();
  });

  function run(args) {
    return spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000,
    });
  }

  // C3: нет argv (файл не передан)
  it('C3: нет аргумента файла → exit 1, stderr "usage"', () => {
    const r = run([]);
    assert.equal(r.status, 1, `ожидался exit 1, получили ${r.status}`);
    // patch-macho.js пишет в console.error → stderr; но для надёжности
    // проверяем оба потока.
    const combined = (r.stderr || '') + (r.stdout || '');
    assert.match(combined, /usage/i,
      `ожидалось "usage" в выводе: ${JSON.stringify({ stderr: r.stderr, stdout: r.stdout })}`);
  });

  // C4: пустой файл (0 байт) — buf.length < 32
  it('C4: пустой файл (0 байт) → exit 1, stderr "слишком короткий/пустой"', () => {
    const file = path.join(tmpDir, 'empty.bin');
    fs.writeFileSync(file, Buffer.alloc(0));
    assert.equal(fs.statSync(file).size, 0, 'temp-файл не пустой');
    const r = run([file]);
    assert.equal(r.status, 1, `ожидался exit 1, получили ${r.status}`);
    assert.match(r.stderr || '', /слишком короткий|пустой/,
      `stderr не содержит "слишком короткий/пустой": ${JSON.stringify(r.stderr)}`);
  });

  // C4b: короткий файл <32 байт (10 байт мусора)
  it('C4b: короткий файл (10 байт) → exit 1, stderr "слишком короткий"', () => {
    const file = path.join(tmpDir, 'short.bin');
    fs.writeFileSync(file, Buffer.alloc(10, 0xAB));
    assert.equal(fs.statSync(file).size, 10);
    const r = run([file]);
    assert.equal(r.status, 1, `ожидался exit 1, получили ${r.status}`);
    assert.match(r.stderr || '', /слишком короткий/,
      `stderr не содержит "слишком короткий": ${JSON.stringify(r.stderr)}`);
  });

  // C5: не-Mach-O (магия ≠ 0xfeedfacf)
  it('C5: не Mach-O файл → exit 1, stderr "не Mach-O"', () => {
    const file = path.join(tmpDir, 'not-macho.txt');
    fs.writeFileSync(file, 'not a macho file at all, just text');
    const r = run([file]);
    assert.equal(r.status, 1, `ожидался exit 1, получили ${r.status}`);
    assert.match(r.stderr || '', /не Mach-O/,
      `stderr не содержит "не Mach-O": ${JSON.stringify(r.stderr)}`);
  });

  // бонус: валидный crafted Mach-O fixture (переиспользуем buildFakeMachO)
  // → exit 0, скрипт не падает. Без 'write' файл не модифицируется.
  it('бонус: валидный crafted Mach-O → exit 0 (не падает)', () => {
    const file = path.join(tmpDir, 'valid.macho');
    fs.writeFileSync(file, buildFakeMachO());
    const r = run([file]);
    assert.equal(r.status, 0,
      `ожидался exit 0, получили ${r.status}; stderr=${r.stderr || ''}; stdout=${r.stdout || ''}`);
  });
});
