/* Собирает Payload/SoundWave.app и упаковывает в SoundWave.ipa */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, 'Payload', 'SoundWave.app');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'www'), { recursive: true });

const copy = (src, dst) => fs.copyFileSync(path.join(ROOT, src), path.join(APP, dst));
copy('SoundWave', 'SoundWave');
copy('Info.plist', 'Info.plist');
copy('icons/AppIcon60x60@2x.png', 'AppIcon60x60@2x.png');
copy('icons/AppIcon60x60@3x.png', 'AppIcon60x60@3x.png');
fs.copyFileSync(path.join(ROOT, '..', 'index.html'), path.join(APP, 'www', 'index.html'));

console.log('Файлы приложения:');
const walk = (d, p = '') => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const rel = p + '/' + e.name;
  if (e.isDirectory()) walk(path.join(d, e.name), rel);
  else console.log('  ' + rel, fs.statSync(path.join(d, e.name)).size, 'байт');
});
walk(APP);

execFileSync('tar', ['--format', 'zip', '-cf', 'SoundWave.ipa', 'Payload'], { cwd: DIST, stdio: 'inherit' });
fs.copyFileSync(path.join(DIST, 'SoundWave.ipa'), path.join(DIST, 'SoundWave.tipa'));
const ipa = path.join(DIST, 'SoundWave.ipa');
const magic = fs.readFileSync(ipa).slice(0, 2).toString('latin1');
if (magic !== 'PK') throw new Error('получился не zip: ' + magic);
console.log('\nГотово:', ipa, (fs.statSync(ipa).size / 1024).toFixed(1), 'КБ (zip: OK)');
