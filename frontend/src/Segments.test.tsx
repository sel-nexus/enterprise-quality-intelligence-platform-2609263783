import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import Segments from './Segments';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('segment inventory', () => {
  it('shows loading and empty state, without write controls for viewers', async () => {
    let resolve!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(done => { resolve = done; }));
    render(<Segments isAdmin={false} />);
    expect(screen.getByText('Loading segments…')).toBeInTheDocument();
    resolve(json({ items: [] }));
    expect(await screen.findByText('No segments yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create segment' })).not.toBeInTheDocument();
  });

  it('creates and edits segments with server responses', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ id: '1', name: 'North', owner: 'Lee' }, 201))
      .mockResolvedValueOnce(json({ id: '1', name: 'North', owner: 'Sam' }));
    const user = userEvent.setup();
    render(<Segments isAdmin />);
    await screen.findByText('No segments yet.');
    await user.type(screen.getByLabelText('Name'), 'North');
    await user.type(screen.getByLabelText('Owner'), 'Lee');
    await user.click(screen.getByRole('button', { name: 'Create segment' }));
    expect(await screen.findByText('Lee')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit North' }));
    await user.clear(screen.getByLabelText('Owner'));
    await user.type(screen.getByLabelText('Owner'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(fetcher.mock.calls[2][1]?.method).toBe('PUT');
  });

  it('shows load errors and retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup();
    render(<Segments isAdmin={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('No segments yet.')).toBeInTheDocument();
  });

  it('retains entered values when the server rejects a duplicate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({}, 409));
    const user = userEvent.setup();
    render(<Segments isAdmin />);
    await screen.findByText('No segments yet.');
    await user.type(screen.getByLabelText('Name'), 'North');
    await user.type(screen.getByLabelText('Owner'), 'Lee');
    await user.click(screen.getByRole('button', { name: 'Create segment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByLabelText('Name')).toHaveValue('North');
  });
});
