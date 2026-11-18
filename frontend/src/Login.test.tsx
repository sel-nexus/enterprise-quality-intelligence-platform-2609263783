import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import Login from './Login';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local sign in', () => {
  it('submits credentials and provides the returned identity', async () => {
    const identity = { id: '1', name: 'Test Admin', email: 'admin@example.test', role: 'admin', status: 'active' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ user: identity }), { status: 200 }));
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<Login onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), identity.email);
    await user.type(screen.getByLabelText('Password'), 'local-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith(identity));
  });

  it('shows invalid credential errors without navigating', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<Login onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'admin@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(onLogin).not.toHaveBeenCalled();
  });
});
