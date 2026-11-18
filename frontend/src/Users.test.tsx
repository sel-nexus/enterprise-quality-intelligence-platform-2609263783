import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import Users from './Users';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const segment = { id: 's1', name: 'North' };
const account = { id: 'u1', name: 'Pat', email: 'pat@example.test', role: 'viewer', status: 'active', segmentId: 's1' };

describe('user administration', () => {
  it('shows loading and empty states', async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(json({ items: [] }));
    render(<Users />);
    expect(screen.getByText('Loading users…')).toBeInTheDocument();
    resolve(json({ items: [] }));
    expect(await screen.findByText('No users yet.')).toBeInTheDocument();
  });

  it('creates and updates displayed access fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [segment] }))
      .mockResolvedValueOnce(json(account, 201)).mockResolvedValueOnce(json({ ...account, role: 'auditor', status: 'disabled', segmentId: null }));
    const user = userEvent.setup(); render(<Users />);
    await screen.findByText('No users yet.');
    await user.type(screen.getByLabelText('Name'), 'Pat');
    await user.type(screen.getByLabelText('Email'), 'pat@example.test');
    await user.type(screen.getByLabelText('Password'), 'password-at-least-12');
    await user.selectOptions(screen.getByLabelText('Segment'), 's1');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByRole('row', { name: /Pat/ })).toHaveTextContent('North');
    await user.click(screen.getByRole('button', { name: 'Edit Pat' }));
    await user.selectOptions(screen.getByLabelText('Role'), 'auditor');
    await user.selectOptions(screen.getByLabelText('Status'), 'disabled');
    await user.selectOptions(screen.getByLabelText('Segment'), '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('row', { name: /Pat/ })).toHaveTextContent('auditor');
    expect(screen.getByRole('row', { name: /Pat/ })).toHaveTextContent('disabled');
  });

  it('reports authorization errors and retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup(); render(<Users />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Administrator');
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('No users yet.')).toBeInTheDocument();
  });

  it('retains the form when a write is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [account] })).mockResolvedValueOnce(json({ items: [segment] }))
      .mockResolvedValueOnce(json({ message: 'Cannot disable or demote the last active administrator' }, 409));
    const user = userEvent.setup(); render(<Users />);
    await screen.findByText('Pat');
    await user.click(screen.getByRole('button', { name: 'Edit Pat' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'disabled');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('last active administrator');
    expect(screen.getByLabelText('Status')).toHaveValue('disabled');
  });
});
