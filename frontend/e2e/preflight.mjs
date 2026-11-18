/** Capture representative rendering and accessibility information for review. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const email = `preflight-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('hex');
const env = { ...process.env, E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password,
  E2E_AUTH_SECRET: randomBytes(32).toString('hex'), E2E_FRONTEND_PORT: '4175', E2E_BACKEND_PORT: '4302' };
const server = spawn(process.execPath, ['e2e/start-servers.mjs'], { env, stdio: 'inherit' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch('http://127.0.0.1:4175')).ok) { ready = true; break; } } catch { /* Wait for server. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Preflight server did not start');
  browser = await chromium.launch({ headless: true });
  const entries = [];
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto('http://127.0.0.1:4175');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('heading', { name: 'Executive overview' }).waitFor();
    const tree = await page.accessibility.snapshot();
    const styles = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor }));
    entries.push({ name, tree, styles, html: await page.content() });
    await page.screenshot({ path: `preflight-${name}.png`, fullPage: true });
    await page.close();
  }
  await writeFile('preflight.txt', JSON.stringify(entries, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}
