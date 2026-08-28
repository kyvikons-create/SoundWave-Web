/* Патчит Mach-O: платформа MACOS → IOS, minos → 15.0, sdk → 18.0
   и печатает сводку заголовков. */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node patch-macho.js <file> [write]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('файл не найден: ' + file);
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.length < 32) {
  console.error('слишком короткий/пустой файл: ' + buf.length + ' байт');
  process.exit(1);
}
if (buf.readUInt32LE(0) !== 0xfeedfacf) {
  console.error('не Mach-O 64 LE');
  process.exit(1);
}

try {
  const cputype = buf.readUInt32LE(4);
  const cpusubtype = buf.readUInt32LE(8);
  const filetype = buf.readUInt32LE(12);
  const ncmds = buf.readUInt32LE(16);
  const flags = buf.readUInt32LE(24);
  const PIE = 0x200000;

  console.log('cputype:', cputype.toString(16), '(100000c=arm64)');
  console.log('filetype:', filetype, '(2=execute)');
  console.log('flags:', flags.toString(16), 'PIE:', !!(flags & PIE));
  console.log('ncmds:', ncmds);

  let off = 32;
  const dylibs = [];
  let patched = 0;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > buf.length) break;
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmdsize < 8 || off + cmdsize > buf.length) break;
    if (cmd === 0x32) { // LC_BUILD_VERSION
      const platform = buf.readUInt32LE(off + 8);
      const minos = buf.readUInt32LE(off + 12);
      const sdk = buf.readUInt32LE(off + 16);
      const v = x => `${x >> 16}.${(x >> 8) & 0xff}.${x & 0xff}`;
      console.log(`LC_BUILD_VERSION: platform=${platform} minos=${v(minos)} sdk=${v(sdk)}`);
      if (platform !== 2) {
        buf.writeUInt32LE(2, off + 8);          // IOS
        buf.writeUInt32LE((15 << 16) | 0, off + 12); // 15.0.0
        buf.writeUInt32LE((18 << 16) | 0, off + 16); // 18.0.0
        patched++;
        console.log('→ пропатчено на platform=IOS minos=15.0 sdk=18.0');
      }
    }
    if (cmd === 0x19) { // SEGMENT_64
      const seg = buf.toString('utf8', off + 8, off + 24).replace(/\0.*$/s, '');
      if (seg === '__LINKEDIT') {
        // запас под реальную подпись (сертификат + entitlements + хэши),
        // иначе страницы выходят за vmsize сегмента → «Invalid Page»
        if (off + 40 <= buf.length) {
          const old = buf.readBigUInt64LE(off + 32);
          buf.writeBigUInt64LE(0x40000n, off + 32);
          console.log(`__LINKEDIT vmsize: 0x${old.toString(16)} → 0x40000`);
        }
      }
    }
    if (cmd === 0xc) { // LC_LOAD_DYLIB
      const nameOff = buf.readUInt32LE(off + 8);
      let e = off + nameOff; while (e < buf.length && buf[e] !== 0) e++;
      dylibs.push(buf.toString('utf8', off + nameOff, e));
    }
    off += cmdsize;
  }
  console.log('dylibs:');
  dylibs.forEach(d => console.log('  -', d));
  if (process.argv[3] === 'write') { fs.writeFileSync(file, buf); console.log('файл записан'); }
} catch (e) {
  console.error('ошибка обработки: ' + e.message);
  process.exit(1);
}
