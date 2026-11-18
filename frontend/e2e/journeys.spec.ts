import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures';

test('protected deep link requires sign-in and its API rejects anonymous access', async ({ page }) => {
  const denied = await page.request.get('/api/v1/users');
  expect(denied.status()).toBe(401);
  const session = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/me'));
  await page.goto('/users');
  expect((await session).status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Users' })).toHaveCount(0);
});

test('viewer cannot access administrator pages or the users API', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL!, password = process.env.E2E_ADMIN_PASSWORD!;
  const viewerEmail = `viewer-${randomBytes(8).toString('hex')}@example.test`;
  const viewerPassword = randomBytes(24).toString('hex');
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser Viewer');
  await page.getByLabel('Email', { exact: true }).fill(viewerEmail);
  await page.getByLabel('Password', { exact: true }).fill(viewerPassword);
  const created = page.waitForResponse(response => response.url().endsWith('/api/v1/users') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create user' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('row').filter({ hasText: viewerEmail })).toContainText('viewer');
  await page.getByRole('link', { name: 'Portal home' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email').fill(viewerEmail);
  await page.getByLabel('Password').fill(viewerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(viewerEmail)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Applications' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Executive overview' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/users')).status()).toBe(403);
  expect((await page.request.get('/api/v1/applications')).status()).toBe(403);
  for (const [path, message] of [
    ['/users', 'Administrator access required.'],
    ['/overview', 'Administrator or executive access required.'],
  ]) {
    const deniedPage = await page.context().newPage();
    const errors: string[] = [];
    deniedPage.on('pageerror', error => errors.push(error.message));
    deniedPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await deniedPage.goto(path);
    await expect(deniedPage.getByRole('alert')).toHaveText(message);
    expect(errors).toEqual([]);
    await deniedPage.close();
  }
});

test('mobile administrator signs in, creates a segment and sees it after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const name = `Mobile ${randomBytes(6).toString('hex')}`;
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Segments' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Owner').fill('Mobile owner');
  const created = page.waitForResponse(response => response.url().endsWith('/api/v1/segments') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create segment' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Mobile owner');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Mobile owner');
  await page.screenshot({ path: test.info().outputPath('mobile-segment.png'), fullPage: true });
});

test('fresh SQLite inventory shows empty state after a real delayed backend response', async ({ page }) => {
  // A second, untouched server/database avoids test-order dependence.
  await page.goto('http://127.0.0.1:4174/');
  await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/v1/segments', async route => {
    requested();
    await gate;
    await route.continue(); // No fabricated response: the actual backend handles this request.
  });
  const response = page.waitForResponse(result => result.url().endsWith('/api/v1/segments') && result.request().method() === 'GET');
  try {
    await page.getByRole('link', { name: 'Segments' }).click();
    await requestStarted;
    await expect(page.getByRole('status')).toHaveText('Loading segments…');
    await page.screenshot({ path: test.info().outputPath('loading-segments.png'), fullPage: true });
  } finally { release(); }
  const result = await response;
  expect(result.status()).toBe(200);
  expect((await result.json()).items).toEqual([]);
  await expect(page.getByText('No segments yet.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('empty-segments.png'), fullPage: true });
  await page.getByRole('link', { name: 'Applications' }).click();
  await expect(page.getByText('No applications yet.')).toBeVisible();
  await expect(page.getByText('Create a segment before adding an application.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('empty-applications.png'), fullPage: true });
});
