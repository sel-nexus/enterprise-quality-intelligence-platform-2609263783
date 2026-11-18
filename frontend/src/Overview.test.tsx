import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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

  it.each(['success', 'HTTP error', 'network rejection'])('ignores a pending overview %s after unmount', async outcome => {
    let resolve!: (response: Response) => void;
    let reject!: (error: Error) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = render(<Overview />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading overview');
    expect(fetcher).toHaveBeenCalledOnce();

    unmount();
    await act(async () => {
      if (outcome === 'success') resolve(json(data));
      else if (outcome === 'HTTP error') resolve(json({}, 403));
      else reject(new Error('offline'));
      await new Promise(done => setTimeout(done, 0));
    });

    expect(container).toBeEmptyDOMElement();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps the fresh overview visible when an older unmounted request resolves later', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
      .mockReturnValueOnce(new Promise(done => { resolveNew = done; }));
    const { rerender } = render(<Overview key="old" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading overview');

    rerender(<Overview key="new" />);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading overview');
    await act(async () => { resolveNew(json(data)); });
    expect(screen.getByText('Segments').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Applications').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Active users').nextElementSibling).toHaveTextContent('4');

    await act(async () => {
      resolveOld(json({ counts: { segments: 91, applications: 92, activeUsers: 93 }, qualityScore: null }));
      await new Promise(done => setTimeout(done, 0));
    });
    expect(screen.getByText('Segments').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Applications').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Active users').nextElementSibling).toHaveTextContent('4');
    expect(screen.queryByText('91')).not.toBeInTheDocument();
    expect(screen.queryByText('92')).not.toBeInTheDocument();
    expect(screen.queryByText('93')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Administrator or executive access required');
  });

  it('reports errors and retries loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(data));
    const user = userEvent.setup(); render(<Overview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('session has expired');
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('Segments')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { failure: 'server error', response: json({ detail: 'private server detail' }, 500), message: 'Unable to complete the request. Please try again.' },
    { failure: 'forbidden response', response: json({}, 403), message: 'Administrator or executive access required.' },
    { failure: 'network failure', rejection: new TypeError('Failed to fetch'), message: 'Failed to fetch' },
    { failure: 'non-Error rejection', rejection: 'offline', message: 'Unable to load overview.' },
  ])('shows a $failure while loading and succeeds on retry', async ({ response, rejection, message }) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    if (response) fetcher.mockResolvedValueOnce(response);
    else fetcher.mockRejectedValueOnce(rejection);
    fetcher.mockResolvedValueOnce(json(data));
    const user = userEvent.setup(); render(<Overview />);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Segments')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect((await screen.findByText('Segments')).nextElementSibling).toHaveTextContent('2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/overview', { credentials: 'same-origin' });
  });

  it.each([
    { failure: 'server error', response: json({ detail: 'private server detail' }, 500), message: 'Unable to complete the request. Please try again.' },
    { failure: 'expired session', response: json({}, 401), message: 'Your session has expired. Please sign in again.' },
    { failure: 'network failure', rejection: new TypeError('Failed to fetch'), message: 'Failed to fetch' },
    { failure: 'non-Error rejection', rejection: 'offline', message: 'Unable to download report.' },
  ])('shows a $failure during download and succeeds on retry', async ({ response, rejection, message }) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(data));
    if (response) fetcher.mockResolvedValueOnce(response);
    else fetcher.mockRejectedValueOnce(rejection);
    fetcher.mockResolvedValueOnce(new Response('csv', { status: 200 }));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup(); render(<Overview />);

    await screen.findByText('Segments');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/overview/report.csv', { credentials: 'same-origin' });
  });

  it('lets an executive navigate to the aggregate overview and download its report', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(data)).mockResolvedValueOnce(new Response('csv', { status: 200 }));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<Shell user={{ id: '2', name: 'Executive', email: 'executive@example.test', role: 'executive', status: 'active' }} onLogout={() => {}} error="" page="overview" />);
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Executive overview' })).toHaveAttribute('href', '/overview');
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect((await screen.findByText('Active users')).nextElementSibling).toHaveTextContent('4');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/overview/report.csv', { credentials: 'same-origin' });
    expect(click).toHaveBeenCalledOnce();
  });

  it('does not mount overview or expose navigation to a viewer', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    render(<Shell user={{ id: '1', name: 'Viewer', email: 'viewer@example.test', role: 'viewer', status: 'active' }} onLogout={() => {}} error="" page="overview" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Administrator or executive access required');
    expect(within(screen.getByRole('navigation')).queryByText('Executive overview')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
