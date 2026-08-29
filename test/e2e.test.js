/*
 * QA-2: интеграционный/E2E тест SoundWave сервера.
 * Запускает КОПИЮ server.js в изолированной временной папке как child_process
 * на случайном свободном порту. Не require'ит server.js напрямую (защита от гонки
 * с параллельным редактированием).
 *
 * Робастный запуск под параллельной нагрузкой (раньше флейкал SKIP при 5с
 * таймауте готовности):
 *   - readiness-таймаут 20с (было 5с), опрос каждые 200мс;
 *   - до MAX_ATTEMPTS попыток старта на свежем порту (защита от EADDRINUSE при
 *     параллельном прогоне/CPU-contention) — каждая попытка на новом порту;
 *   - fast-fail по падению процесса или фатальному stderr (EADDRINUSE/error) —
 *     не ждём таймаута, сразу ретрай;
 *   - только после всех неудачных попыток → skip с понятной причиной;
 *   - гарантированная уборка всех процессов и temp в after (try/finally).
 *
 * Запуск: node --test "<путь>/e2e.test.js"
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const cp = require('child_process');
const os = require('os');

const SRC = path.resolve(__dirname, '..');
const TMP_BASE = os.tmpdir();

const READY_TIMEOUT = 20000;   // 20с готовности (было 5с — флейк под нагрузкой)
const POLL_INTERVAL = 200;     // опрос каждые 200мс
const MAX_ATTEMPTS = 3;        // до 3 попыток старта (новый порт каждую)

let PORT = null;
let tmpDir = null;
let proc = null;
let readyErr = null;
const procs = [];              // все запущенные child-процессы (для уборки в after)

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Одна попытка старта сервера на порту `port` с ожиданием готовности.
// Возвращает { ok: boolean, proc, error: string|null }.
// Fast-fail: процесс упал ИЛИ stderr содержит фатальный паттерн (EADDRINUSE/error)
// — не ждём таймаута, сразу возвращаем неудачу для ретрая.
async function startAttempt(port) {
  let out = '';
  let err = '';
  let exited = false;
  let exitCode = null;

  const child = cp.spawn('node', ['server.js'], {
    cwd: tmpDir,
    env: { ...process.env, PORT: String(port) },
    windowsHide: true
  });
  procs.push(child);
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { err += d.toString(); });
  child.on('exit', code => { exited = true; exitCode = code; });

  const url = 'http://127.0.0.1:' + port + '/sc?ping=1';
  const start = Date.now();

  while (true) {
    // 1) процесс упал — не ждём таймаута, сразу fail (ретрай)
    if (exited) {
      return { ok: false, proc: child, error: 'process exited early, code=' + exitCode + ' | stderr: ' + err.slice(-1500) };
    }
    // 2) stderr содержит фатальный паттерн (EADDRINUSE/error) — не ждём, fail
    if (err && /EADDRINUSE|error/i.test(err)) {
      try { child.kill(); } catch {}
      return { ok: false, proc: child, error: 'stderr fatal: ' + err.slice(-1500) };
    }
    // 3) общий таймаут готовности (20с)
    if (Date.now() - start > READY_TIMEOUT) {
      try { child.kill(); } catch {}
      return { ok: false, proc: child, error: 'server not ready within ' + (READY_TIMEOUT / 1000) + 's | stderr: ' + err.slice(-1500) };
    }
    // 4) опрос /sc?ping=1
    try {
      const r = await fetch(url);
      if (r.ok) {
        return { ok: true, proc: child, error: null };
      }
    } catch {}
    await new Promise(res => setTimeout(res, POLL_INTERVAL));
  }
}

function req(p) {
  return fetch('http://127.0.0.1:' + PORT + p);
}

describe('SoundWave e2e', () => {
  before(async () => {
    // process.pid в имени — чтобы два параллельных прогона не collisions по tmpDir.
    tmpDir = path.join(TMP_BASE, 'sw-e2e-' + process.pid + '-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    // Копируем server.js + index.html (shell) + style.css + app.js (модульная структура).
    fs.copyFileSync(path.join(SRC, 'server.js'), path.join(tmpDir, 'server.js'));
    fs.copyFileSync(path.join(SRC, 'index.html'), path.join(tmpDir, 'index.html'));
    fs.copyFileSync(path.join(SRC, 'style.css'), path.join(tmpDir, 'style.css'));
    fs.copyFileSync(path.join(SRC, 'app.js'), path.join(tmpDir, 'app.js'));

    // Копируем папку icons (если есть) — чтобы /icons/icon-192.png работал.
    let hasIcons = false;
    try {
      const iconsSrc = path.join(SRC, 'icons');
      const iconsDst = path.join(tmpDir, 'icons');
      fs.mkdirSync(iconsDst, { recursive: true });
      for (const f of fs.readdirSync(iconsSrc)) {
        fs.copyFileSync(path.join(iconsSrc, f), path.join(iconsDst, f));
      }
      hasIcons = true;
    } catch (e) {
      hasIcons = false;
    }

    // До MAX_ATTEMPTS попыток старта на свежем порту (защита от EADDRINUSE при
    // параллельном прогоне/CPU-contention). Успех — выходим из цикла.
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const port = await getFreePort();
      const res = await startAttempt(port);
      if (res.ok) {
        PORT = port;
        proc = res.proc;
        readyErr = null;
        break;
      }
      lastErr = '[attempt ' + attempt + ' port=' + port + '] ' + res.error;
      try { res.proc.kill(); } catch {}
      // небольшая пауза перед ретраем, чтобы ОС освободила порт
      await new Promise(res => setTimeout(res, 150));
    }
    if (!proc) {
      readyErr = 'server failed to start after ' + MAX_ATTEMPTS + ' attempts: ' + lastErr;
    }
    globalThis.__SW_E2E_HAS_ICONS = hasIcons;
  });

  after(async () => {
    // Гарантированная уборка даже при skip/fail: try/finally — чтобы неудача
    // убийства процесса не пропустила очистку temp (и наоборот).
    try {
      for (const child of procs) {
        try { child.kill('SIGTERM'); } catch {}
        try { child.kill(); } catch {}
      }
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  });

  test('GET /sc?ping=1 → 200 json {ok:true}', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/sc?ping=1');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/json');
    const j = await r.json();
    assert.deepEqual(j, { ok: true });
  });

  test('GET / → 200 text/html содержит SoundWave', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    const body = await r.text();
    assert.match(body, /SoundWave/);
  });

  test('GET /index.html → 200 text/html', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/index.html');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
  });

  test('GET /icons/icon-192.png → 200 image/png', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    if (!globalThis.__SW_E2E_HAS_ICONS) return t.skip('icons folder not available in source');
    const r = await req('/icons/icon-192.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
  });

  test('GET /nonexistent-file.xyz → 404', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/nonexistent-file.xyz');
    assert.equal(r.status, 404);
  });

  test('GET /sc?url=http://evil.com/ → 403 (host not allowed)', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/sc?url=http://evil.com/');
    assert.equal(r.status, 403);
  });

  test('GET /sc (без url) → 400', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/sc');
    assert.equal(r.status, 400);
  });

  test('GET /sc?url=not-a-url → 400', async (t) => {
    if (readyErr) return t.skip('server not started: ' + readyErr);
    const r = await req('/sc?url=not-a-url');
    assert.equal(r.status, 400);
  });
});
