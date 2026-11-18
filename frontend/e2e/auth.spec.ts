import { expect, test } from './fixtures';

test('local sign-in, reload and sign-out', async ({ page, browserErrors }) => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to the local bootstrap credentials');
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('incorrect-password');
  browserErrors.allowFailedLogin();
  const failedLogin = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await failedLogin).status()).toBe(401);
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
