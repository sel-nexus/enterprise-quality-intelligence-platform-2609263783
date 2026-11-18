import { expect, test as base } from '@playwright/test';

type ErrorControls = { allowFailedLogin: () => void; endUnauthenticatedStartup: () => void };

// Preserve every browser error; permit only the exact expected Chromium network
// diagnostic for the corresponding deliberate authentication request.
export const test = base.extend<{ browserErrors: ErrorControls }>({
  browserErrors: [async ({ page }, use) => {
    const errors: { text: string; url: string; allowed: boolean }[] = [];
    const expectedResponses = { me: 0, login: 0 };
    let unauthenticatedStartup = true;
    let failedLogin = false;
    page.on('pageerror', error => errors.push({ text: error.message, url: '', allowed: false }));
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() === 401 && response.request().method() === 'GET' && path === '/api/v1/auth/me' && unauthenticatedStartup) expectedResponses.me++;
      if (response.status() === 401 && response.request().method() === 'POST' && path === '/api/v1/auth/login' && failedLogin) expectedResponses.login++;
      if (response.ok() && response.request().method() === 'POST' && path === '/api/v1/auth/login') {
        unauthenticatedStartup = false;
        failedLogin = false;
      }
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const url = message.location().url;
      const path = url ? new URL(url).pathname : '';
      const network401 = /^Failed to load resource: the server responded with a status of 401 \(Unauthorized\)$/.test(message.text());
      const allowed = network401 && ((path === '/api/v1/auth/me' && unauthenticatedStartup) || (path === '/api/v1/auth/login' && failedLogin));
      errors.push({ text: message.text(), url, allowed });
    });
    await use({ allowFailedLogin: () => { failedLogin = true; }, endUnauthenticatedStartup: () => { unauthenticatedStartup = false; } });
    const meErrors = errors.filter(error => error.allowed && new URL(error.url).pathname === '/api/v1/auth/me');
    const loginErrors = errors.filter(error => error.allowed && new URL(error.url).pathname === '/api/v1/auth/login');
    expect(meErrors.length).toBeLessThanOrEqual(expectedResponses.me);
    expect(loginErrors.length).toBeLessThanOrEqual(expectedResponses.login);
    expect(errors.filter(error => !error.allowed)).toEqual([]);
  }, { auto: true }]
});
export { expect };
