import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import Overview from './Overview';
import Shell from './Shell';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const data = { counts: { segments: 2, applications: 3, activeUsers: 4 }, qualityScore: null };

describe('executive overview', () => {
  it('shows loading, empty inventory and explicitly unavailable scores', async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<Overview />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading overview');
    resolve(json({ counts: { segments: 0, applications: 0, activeUsers: 1 }, qualityScore: null }));
    expect(await screen.findByText(/No segments or applications/)).toBeInTheDocument();
    expect(screen.getByText(/Unavailable — quality scoring/)).toBeInTheDocument();
    expect(screen.getByText('Active users').nextElementSibling).toHaveTextContent('1');
  });

  it('displays counts, downloads the report and handles report failure', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(data))
      .mockResolvedValueOnce(new Response('csv', { status: 200 })).mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup(); render(<Overview />);
    expect((await screen.findByText('Segments')).nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Applications').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Active users').nextElementSibling).toHaveTextContent('4');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/overview/report.csv', { credentials: 'same-origin' });
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access required');
  });

  it('reports errors and retries loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(data));
    const user = userEvent.setup(); render(<Overview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('session has expired');
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('Segments')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not mount overview or expose navigation to a nonadministrator', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<Shell user={{ id: '1', name: 'Viewer', email: 'viewer@example.test', role: 'viewer', status: 'active' }} onLogout={() => {}} error="" page="overview" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Administrator access required');
    expect(within(screen.getByRole('navigation')).queryByText('Executive overview')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
