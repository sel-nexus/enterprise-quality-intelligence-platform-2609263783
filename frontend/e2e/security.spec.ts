import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from './fixtures';

/** Reserve a local port for a disposable test server. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local port');
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}

/** Wait until a spawned server is ready or report its failure. */
async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Server exited before readiness: ${url}`);
    try { if ((await fetch(url)).ok) return; } catch { /* Server is still starting. */ }
    await delay(100);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

test('legacy markup returned by the real backend renders as text without execution', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'eqip-legacy-xss-'));
  const dbPath = join(dir, 'legacy.sqlite');
  const name = '<img src=x onerror="window.__legacyXss=1">';
  const owner = '<svg onload="window.__legacyXss=2"></svg>';
  const email = `admin-${randomBytes(8).toString('hex')}@example.test`;
  const password = randomBytes(24).toString('hex');
  const children: ChildProcess[] = [];
  try {
    // Seed pre-policy data directly, before the actual API opens the disposable file.
    const database = new DatabaseSync(dbPath);
    try {
      database.exec('CREATE TABLE segments (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, owner TEXT NOT NULL)');
      database.prepare('INSERT INTO segments (id, name, owner) VALUES (?, ?, ?)').run('legacy-xss', name, owner);
    } finally { database.close(); }

    const backendPort = await freePort();
    let frontendPort = await freePort();
    while (frontendPort === backendPort) frontendPort = await freePort();
    const frontend = resolve(testInfo.file, '../..');
    const backend = resolve(frontend, '../backend');
    const api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: backend, stdio: 'inherit', env: {
        ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(backendPort), DATABASE_PATH: dbPath,
        AUTH_SECRET: randomBytes(32).toString('hex'), BOOTSTRAP_ADMIN_EMAIL: email,
        BOOTSTRAP_ADMIN_PASSWORD: password, BOOTSTRAP_ADMIN_NAME: 'Legacy test administrator'
      }
    });
    children.push(api);
    await waitForServer(`http://127.0.0.1:${backendPort}/api/health`, api);
    const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: frontend, stdio: 'inherit', env: { ...process.env, VITE_API_BASE: '', VITE_PROXY_TARGET: `http://127.0.0.1:${backendPort}` }
    });
    children.push(web);
    const origin = `http://127.0.0.1:${frontendPort}`;
    await waitForServer(origin, web);

    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await page.goto(origin);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/segments') && response.request().method() === 'GET');
    await page.getByRole('link', { name: 'Segments' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect((await response.json()).items).toContainEqual({ id: 'legacy-xss', name, owner });
    const row = page.getByRole('row').filter({ hasText: 'legacy-xss' });
    await expect(row.locator('td').nth(0)).toHaveText(name);
    await expect(row.locator('td').nth(1)).toHaveText(owner);
    await expect(row.locator('img, svg, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __legacyXss?: number }).__legacyXss)).toBeUndefined();
    expect(dialogs).toEqual([]);
  } finally {
    await page.close();
    await Promise.all(children.map(child => new Promise<void>(done => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once('exit', () => done());
      child.kill('SIGTERM');
    })));
    rmSync(dir, { recursive: true, force: true });
  }
});
