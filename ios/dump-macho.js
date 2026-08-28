/* Полный дамп load commands и секций Mach-O */
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2] || 'SoundWave');
const R32 = o => buf.readUInt32LE(o);
const R64 = o => buf.readBigUInt64LE(o);
const str = (o, l) => buf.toString('utf8', o, o + l).replace(/\0.*$/s, '');

console.log('magic:', R32(0).toString(16), 'cputype:', R32(4).toString(16), 'filetype:', R32(12), 'flags:', R32(24).toString(16), 'ncmds:', R32(16));
const CMD = {
  0x1: 'SEGMENT', 0x19: 'SEGMENT_64', 0x2: 'SYMTAB', 0xb: 'DYSYMTAB', 0xc: 'LOAD_DYLIB', 0xd: 'ID_DYLIB',
  0x22: 'DYLD_INFO', 0x80000022: 'DYLD_INFO_ONLY', 0x80000028: 'MAIN',
  0x1b: 'UUID', 0x24: 'VERSION_MIN_MACOSX', 0x25: 'VERSION_MIN_IPHONEOS',
  0x32: 'BUILD_VERSION', 0x1d: 'CODE_SIGNATURE', 0x26: 'FUNCTION_STARTS',
  0x2a: 'SOURCE_VERSION', 0x29: 'DATA_IN_CODE', 0x18: 'RPATH',
  0x80000034: 'DYLD_CHAINED_FIXUPS', 0x80000035: 'DYLD_EXPORTS_TRIE',
  0xf: 'LOAD_WEAK_DYLIB', 0x1e: 'SEGMENT_SPLIT_INFO', 0x2c: 'ENCRYPTION_INFO_64'
};
let off = 32;
for (let i = 0; i < R32(16); i++) {
  const cmd = R32(off), size = R32(off + 4);
  const name = CMD[cmd] || 'cmd:' + cmd.toString(16);
  let extra = '';
  if (cmd === 0x19) { // SEGMENT_64
    const seg = str(off + 8, 16);
    const vmaddr = R64(off + 24), vmsize = R64(off + 32), fileoff = R64(off + 40), filesize = R64(off + 48);
    const nsects = R32(off + 64), flags = R32(off + 72);
    extra = `${seg} vm=${vmaddr.toString(16)}+${vmsize.toString(16)} file=${fileoff}+${filesize} nsects=${nsects} flags=${flags.toString(16)}`;
    let so = off + 72;
    for (let s = 0; s < nsects; s++) {
      const sect = str(so, 16), seg2 = str(so + 16, 16);
      const addr = R64(so + 32), size2 = R64(so + 40), off2 = R64(so + 48);
      const type = buf[so + 64 + 0xff * 0] || buf[so + 64];
      console.log(`    sect ${seg2},${sect} addr=${addr.toString(16)} size=${size2} off=${off2} type=${buf[so + 64]} attr=${R32(so + 68).toString(16)}`);
      so += 80;
    }
  } else if (cmd === 0xc || cmd === 0xe || cmd === 0xf) {
    extra = str(off + R32(off + 8), 96);
  } else if (cmd === 0x80000028) {
    extra = `entryoff=${R64(off + 8)} stacksize=${R64(off + 16)}`;
  } else if (cmd === 0x32) {
    const v = x => `${x >> 16}.${(x >> 8) & 0xff}.${x & 0xff}`;
    extra = `platform=${R32(off + 8)} minos=${v(R32(off + 12))} sdk=${v(R32(off + 16))}`;
  } else if (cmd === 0x2) {
    extra = `symoff=${R32(off + 8)} nsyms=${R32(off + 12)} stroff=${R32(off + 16)} strsize=${R32(off + 20)}`;
  } else if (cmd === 0x80000034) {
    extra = `dataoff=${R32(off + 8)} datasize=${R32(off + 12)}`;
  } else if (cmd === 0x22) {
    extra = buf.toString('hex', off + 8, off + 24);
  }
  console.log(`[${i}] ${name} size=${size} ${extra}`);
  off += size;
}
