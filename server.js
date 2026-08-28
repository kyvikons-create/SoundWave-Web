/*
 * SoundWave — локальный сервер
 *  - раздаёт статику приложения
 *  - проксирует запросы к API SoundCloud (обход CORS и DNS-блокировок:
 *    сначала обычный https, при сбое — curl; адреса резолвятся через DNS-over-HTTPS)
 *
 * Запуск:  node server.js   (или start.bat)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8'
};
const HOST_OK = /^([a-z0-9-]+\.)*(soundcloud\.com|sndcdn\.com)$/i;

/* ---------- валидаторы (экспортируются для тестов) ---------- */

// P3: валидатор Range — отбрасывает CRLF-инъекции и мусор.
// Пропускает только строгий вид "bytes=START-END" (START/END — 0..19 цифр, могут быть пустыми).
function sanitizeRange(v){
  if (typeof v !== 'string') return null;
  if (!/^bytes=\d{0,19}-\d{0,19}$/i.test(v)) return null;
  return v;
}

// P2: true для публичных IP, false для loopback/private/link-local/reserved/multicast/broadcast.
// Используется для проверки IP, полученных от DoH (защита от SSRF/DNS-rebinding).
function isPublicIP(ip){
  if (typeof ip !== 'string' || !ip) return false;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — разбираем как v4
  const v4map = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4map) return isPublicIPv4(v4map[1]);
  // чистый IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return isPublicIPv4(ip);
  // IPv6
  if (ip.includes(':')) return isPublicIPv6(ip);
  return false;
}

function isPublicIPv4(ip){
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return false;                            // 0.0.0.0/8
  if (a === 10) return false;                          // 10/8
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT (RFC 6598)
  if (a === 127) return false;                         // 127/8 loopback
  if (a === 169 && b === 254) return false;            // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16/12
  if (a === 192 && b === 168) return false;            // 192.168/16
  if (a === 198 && b >= 18 && b <= 19) return false;  // 198.18/15 benchmark (RFC 2544)
  if (a >= 224 && a <= 239) return false;              // 224/4 multicast
  if (a >= 240) return false;                           // 240/4 reserved (вкл. 255.255.255.255)
  return true;
}

function isPublicIPv6(ip){
  const lc = ip.toLowerCase();
  if (lc === '::1') return false;                      // loopback
  if (lc === '::') return false;                       // unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lc)) return false;     // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lc)) return false;     // fc00::/7 unique-local
  return true;
}

// P1: безопасный резолв пути статического файла.
// Возвращает {file, ok}: ok=false если путь выходит за пределы root (path traversal).
function resolveStaticPath(p, root){
  const file = path.normalize(path.join(root, p.replace(/^\/+/, '')));
  const rel = path.relative(root, file);
  const ok = !(rel.startsWith('..') || path.isAbsolute(rel));
  return { file, ok };
}

/* ---------- DNS-over-HTTPS (системный DNS может отдавать фейковые адреса) ---------- */
const dohCache = new Map();
async function resolveHost(host){
  if (dohCache.has(host)) return dohCache.get(host);
  const urls = [
    'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=A',
    'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=A'
  ];
  for (const u of urls){
    try {
      const r = await fetch(u, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      const ips = ((j.Answer) || []).filter(a => a.type === 1).map(a => a.data);
      if (ips.length){
        const rec = { ips, ts: Date.now() };
        dohCache.set(host, rec);
        return rec;
      }
    } catch {}
  }
  return null;
}
setInterval(() => { for (const [k, v] of dohCache) if (Date.now() - v.ts > 6e5) dohCache.delete(k); }, 3e5).unref();

/* ---------- прокси двумя способами: node https и curl ---------- */
const hostMethod = new Map(); // host -> 'node' | 'curl'

const PROXY_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
const ACAO = { 'Access-Control-Allow-Origin': '*' };

function pickProxyHeaders(src){
  const out = {};
  if (Array.isArray(src)){
    for (const line of src){
      const c = line.indexOf(':');
      if (c < 0) continue;
      const k = line.slice(0, c).trim().toLowerCase();
      if (PROXY_HEADERS.includes(k)) out[k] = line.slice(c + 1).trim();
    }
  } else if (src && typeof src === 'object'){
    for (const k of PROXY_HEADERS) if (src[k]) out[k] = src[k];
  }
  return out;
}

function proxyViaNode(target, ip, range, res, onFail){
  const opts = {
    host: ip || target.hostname,
    servername: target.hostname,
    port: 443,
    path: target.pathname + target.search,
    headers: { 'User-Agent': UA, Accept: '*/*', Host: target.hostname },
    timeout: 9000
  };
  if (range) opts.headers.Range = range;
  const req = https.get(opts, r => {
    const h = { ...ACAO, ...pickProxyHeaders(r.headers) };
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', () => { if (!res.headersSent) onFail(); else res.end(); });
}

function proxyViaCurl(target, ip, range, res){
  const args = ['-s', '--http1.1', '--max-time', '40', '-i', '-A', UA];
  if (ip) args.push('--resolve', target.hostname + ':443:' + ip);
  if (range) args.push('-H', 'Range: ' + range);
  args.push(target.href);
  const child = spawn('curl', args, { windowsHide: true });
  let buf = Buffer.alloc(0), headerDone = false;
  child.stdout.on('data', d => {
    if (headerDone){ res.write(d); return; }
    buf = Buffer.concat([buf, d]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) return;
    headerDone = true;
    const lines = buf.slice(0, idx).toString('latin1').split('\r\n');
    const m = lines[0].match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = m ? +m[1] : 502;
    const h = { ...ACAO, ...pickProxyHeaders(lines.slice(1)) };
    res.writeHead(status, h);
    const rest = buf.slice(idx + 4);
    if (rest.length) res.write(rest);
  });
  child.stdout.on('end', () => res.end());
  child.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
}

async function handleProxy(req, res){
  const u = new URL(req.url, 'http://localhost');
  if (u.searchParams.has('ping')){
    res.writeHead(200, { ...ACAO, 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  let target;
  try { target = new URL(u.searchParams.get('url')); }
  catch { res.writeHead(400); res.end('bad url'); return; }
  if (!HOST_OK.test(target.hostname)){ res.writeHead(403); res.end('host not allowed'); return; }
  // M2: разрешаем только https — отбрасывает ftp/http/file и пр. даже при валидном hostname.
  if (target.protocol !== 'https:'){ res.writeHead(403); res.end('https only'); return; }

  // P3: прокидываем upstream только sanitized Range (без CRLF-инъекций)
  const range = sanitizeRange(req.headers['range']);

  const doh = await resolveHost(target.hostname);
  const ip = doh ? doh.ips[0] : null;
  // P2: защита от SSRF/DNS-rebinding — если DoH дал приватный/loopback IP, отказываем
  if (ip && !isPublicIP(ip)){
    res.writeHead(403); res.end('blocked ip'); return;
  }

  const method = hostMethod.get(target.hostname) || 'node';

  const viaCurl = () => { hostMethod.set(target.hostname, 'curl'); proxyViaCurl(target, ip, range, res); };
  if (method === 'curl') viaCurl();
  else proxyViaNode(target, ip, range, res, viaCurl);
}

/* ---------- статика ---------- */
function serveStatic(req, res){
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch { res.writeHead(400); res.end('bad request'); return; }
  if (p === '/') p = '/index.html';
  // P1: безопасный резолв пути — отбрасывает path traversal (%2f, .., абсолютные пути)
  const { file, ok } = resolveStaticPath(p, ROOT);
  if (!ok){ res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/sc'))
    handleProxy(req, res).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
  else serveStatic(req, res);
});

// P5: запуск только при прямом вызове `node server.js` — require() в тестах не стартует сервер.
function startServer(){
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ♪ SoundWave запущен');
    console.log('  -------------------------------');
    console.log('  На этом компьютере:');
    console.log('     http://localhost:' + PORT);
    console.log('  На iPhone (та же сеть Wi-Fi):');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)){
      for (const n of nets[name] || []){
        if (n.family === 'IPv4' && !n.internal) console.log('     http://' + n.address + ':' + PORT + '   (' + name + ')');
      }
    }
    console.log('  -------------------------------');
    console.log('  Откройте адрес в Safari на iPhone, затем');
    console.log('  Поделиться → «На экран "Домой"» — появится приложение.');
    console.log('  Остановить сервер: Ctrl+C');
    console.log('');
  }).on('error', e => {
    console.error('Не удалось запустить сервер:', e.message);
    if (e.code === 'EADDRINUSE') console.error('Порт ' + PORT + ' занят. Запустите с другим портом: set PORT=3001 && node server.js');
    process.exit(1);
  });
}

if (require.main === module) startServer();

module.exports = { HOST_OK, isPublicIP, sanitizeRange, resolveStaticPath };
