/** Display administrator-only inventory aggregates and a basic report. */
import { useEffect, useState } from 'react';

interface OverviewData { counts: { segments: number; applications: number; activeUsers: number }; qualityScore: null }
const base = import.meta.env.VITE_API_BASE || '';

/** Explain a failed overview or report request without exposing server details. */
function errorMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'Administrator access required.';
  return 'Unable to complete the request. Please try again.';
}

/** Render current counts and export the same restricted aggregate report. */
export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportError, setReportError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    fetch(`${base}/api/v1/overview`, { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(errorMessage(response.status));
        return response.json() as Promise<OverviewData>;
      })
      .then(value => { if (active) setData(value); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load overview.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  /** Fetch the protected CSV and prompt a browser download. */
  async function download() {
    setDownloading(true); setReportError('');
    try {
      const response = await fetch(`${base}/api/v1/overview/report.csv`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(errorMessage(response.status));
      const url = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement('a');
        link.href = url; link.download = 'eqip-overview.csv';
        document.body.appendChild(link); link.click(); link.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (err) { setReportError(err instanceof Error ? err.message : 'Unable to download report.'); }
    finally { setDownloading(false); }
  }

  return (
    <>
      <p className="eyebrow">EQIP / EXECUTIVE OVERVIEW</p>
      <h1>Executive overview</h1>
      <p className="muted lead">Current inventory counts from the local database.</p>
      {loading && <p role="status">Loading overview…</p>}
      {error && <>
        <p className="error" role="alert">{error}</p>
        <button className="secondary" onClick={() => setVersion(value => value + 1)}>Retry loading</button>
      </>}
      {data && <>
        {data.counts.segments === 0 && data.counts.applications === 0 && <p>No segments or applications have been added yet.</p>}
        <section className="account-summary" aria-labelledby="inventory-title">
          <h2 id="inventory-title">Inventory</h2>
          <dl>
            <div><dt>Segments</dt><dd>{data.counts.segments}</dd></div>
            <div><dt>Applications</dt><dd>{data.counts.applications}</dd></div>
            <div><dt>Active users</dt><dd>{data.counts.activeUsers}</dd></div>
          </dl>
        </section>
        <section className="account-summary" aria-labelledby="quality-title">
          <h2 id="quality-title">Quality score</h2>
          <p>Unavailable — quality scoring is not defined.</p>
        </section>
        <section className="account-summary" aria-labelledby="report-title">
          <h2 id="report-title">Basic report</h2>
          <p className="muted">Internal sensitivity. CSV contains aggregate counts only; no personal records.</p>
          <button type="button" disabled={downloading} onClick={download}>{downloading ? 'Preparing report…' : 'Download CSV'}</button>
          {reportError && <p className="error" role="alert">{reportError}</p>}
        </section>
      </>}
    </>
  );
}
