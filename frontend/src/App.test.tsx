import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

const identity = { id: '1', name: 'Test Admin', email: 'admin@example.test', role: 'admin', status: 'active' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('app session', () => {
  it('shows the loading state until an existing session is restored', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<App />);

    expect(screen.getByText('Checking your session…')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    resolve(json(identity));
    expect(await screen.findByRole('heading', { name: 'Welcome, Test Admin.' })).toBeInTheDocument();
    expect(screen.getByText(identity.email)).toBeInTheDocument();
    expect(screen.queryByText('Checking your session…')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/me', { credentials: 'same-origin' });
  });

  it('shows sign in after an expired session and enters the portal after login', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ user: identity }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Email'), identity.email);
    await user.type(screen.getByLabelText('Password'), 'local-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Test Admin.' })).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: identity.email, password: 'local-password' }), credentials: 'same-origin'
    });
  });

  it('shows sign in when restoring the session fails due to a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network unavailable'));
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Checking your session…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('keeps the portal visible until sign out succeeds, then shows sign in', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(identity))
      .mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Welcome, Test Admin.' })).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
    resolve(json({ message: 'Signed out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('retains the session and displays an error on failed sign out, then clears it after a successful retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(identity))
      .mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json({ message: 'Signed out' }))
      .mockResolvedValueOnce(json({ user: identity }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign out. Please try again.');
    expect(screen.getByRole('heading', { name: 'Welcome, Test Admin.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.type(await screen.findByLabelText('Email'), identity.email);
    await user.type(screen.getByLabelText('Password'), 'local-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Test Admin.' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
