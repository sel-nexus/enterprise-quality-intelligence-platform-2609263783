import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(frontend, '../backend');
const { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_AUTH_SECRET } = process.env;
const frontendPort = process.env.E2E_FRONTEND_PORT || '4173';
const backendPort = process.env.E2E_BACKEND_PORT || '4300';
if (!E2E_ADMIN_EMAIL || !E2E_ADMIN_PASSWORD || !E2E_AUTH_SECRET) throw new Error('Playwright must provide disposable test credentials');

const dir = mkdtempSync(join(tmpdir(), 'eqip-playwright-'));
const children = [];
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(child => new Promise(resolveDone => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveDone();
    child.once('exit', resolveDone);
    child.kill('SIGTERM');
  })));
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

try {
  const build = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: backend, stdio: 'inherit' });
  if (build.status !== 0) throw new Error(`Backend build failed: ${build.error?.message || build.status}`);
  function start(args, cwd, env) {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    children.push(child);
    child.on('error', error => { console.error(error); void stop(1); });
    child.on('exit', (code, signal) => {
      if (!stopping) { console.error(`Server exited unexpectedly (${code ?? signal})`); void stop(1); }
    });
    return child;
  }
  start(['dist/src/main.js'], backend, {
    ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: backendPort,
    DATABASE_PATH: join(dir, 'test.sqlite'), AUTH_SECRET: E2E_AUTH_SECRET,
    BOOTSTRAP_ADMIN_EMAIL: E2E_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
    BOOTSTRAP_ADMIN_NAME: 'Playwright Administrator', CORS_ORIGIN: `http://127.0.0.1:${frontendPort}`
  });
  let ready = false;
  for (let i = 0; i < 200 && !stopping; i++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/health`)).ok) { ready = true; break; } } catch { /* Wait for the process to listen. */ }
    await delay(100);
  }
  if (!ready) throw new Error('Backend did not become healthy');
  start(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], frontend, {
    ...process.env, VITE_API_BASE: '', VITE_PROXY_TARGET: `http://127.0.0.1:${backendPort}`
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
