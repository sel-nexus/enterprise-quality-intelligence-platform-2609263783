import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import Applications from './Applications';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const segment = { id: 's1', name: 'North' };
const app = { id: 'a1', name: 'Atlas', segmentId: 's1', owner: 'Lee', lifecycle: 'Production', criticality: 'High' };

describe('application inventory', () => {
  it('shows loading and empty states', async () => {
    let resolve!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(json({ items: [] }));
    render(<Applications isAdmin />);
    expect(screen.getByText('Loading applications…')).toBeInTheDocument();
    resolve(json({ items: [] }));
    expect(await screen.findByText('No applications yet.')).toBeInTheDocument();
    expect(screen.getByText('Create a segment before adding an application.')).toBeInTheDocument();
  });

  it('creates, searches, edits and renders returned data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [segment] }))
      .mockResolvedValueOnce(json(app, 201)).mockResolvedValueOnce(json({ ...app, owner: 'Pat' }));
    const user = userEvent.setup(); render(<Applications isAdmin />);
    await screen.findByText('No applications yet.');
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Atlas');
    await user.selectOptions(screen.getByLabelText('Segment'), 's1');
    await user.type(screen.getByLabelText('Owner', { exact: true }), 'Lee');
    await user.selectOptions(screen.getByLabelText('Lifecycle'), 'Production');
    await user.selectOptions(screen.getByLabelText('Criticality'), 'High');
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    expect(await screen.findByRole('row', { name: /Atlas/ })).toHaveTextContent('North');
    await user.type(screen.getByLabelText('Search applications or owners'), 'nobody');
    expect(screen.getByText('No applications match your search.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search applications or owners'));
    await user.click(screen.getByRole('button', { name: 'Edit Atlas' }));
    await user.clear(screen.getByLabelText('Owner', { exact: true }));
    await user.type(screen.getByLabelText('Owner', { exact: true }), 'Pat');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('row', { name: /Atlas/ })).toHaveTextContent('Pat');
  });

  it('shows authorization errors and retries without exposing admin controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup(); render(<Applications isAdmin={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('administrator');
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('No applications yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create application' })).not.toBeInTheDocument();
  });

  it('retains form values when a duplicate is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [segment] })).mockResolvedValueOnce(json({}, 409));
    const user = userEvent.setup(); render(<Applications isAdmin />);
    await screen.findByText('No applications yet.');
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Atlas');
    await user.selectOptions(screen.getByLabelText('Segment'), 's1');
    await user.type(screen.getByLabelText('Owner', { exact: true }), 'Lee');
    await user.selectOptions(screen.getByLabelText('Lifecycle'), 'UAT');
    await user.selectOptions(screen.getByLabelText('Criticality'), 'Low');
    await user.click(screen.getByRole('button', { name: 'Create application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('Atlas');
  });
});
