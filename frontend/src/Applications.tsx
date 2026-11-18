/** Display and maintain the application inventory. */
import { useEffect, useState, type FormEvent } from 'react';

interface Application { id: string; name: string; segmentId: string; owner: string; lifecycle: string; criticality: string }
interface Segment { id: string; name: string }
interface Props { isAdmin: boolean }
const base = import.meta.env.VITE_API_BASE || '';
const blank = { name: '', segmentId: '', owner: '', lifecycle: '', criticality: '' };

/** Request inventory data using the browser session. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (response.status === 403) throw new Error('Application access requires an administrator until segment access is configured.');
    if (response.status === 409) throw new Error('An application with this name already exists.');
    if (response.status === 404) throw new Error('This application no longer exists.');
    if (response.status === 400) throw new Error('Check all fields and select an existing segment.');
    throw new Error('Unable to complete the request. Please try again.');
  }
  return response.json() as Promise<T>;
}

export default function Applications({ isAdmin }: Props) {
  const [items, setItems] = useState<Application[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Application | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setLoadFailed(false);
    Promise.all([request<{ items: Application[] }>('/api/v1/applications'), request<{ items: Segment[] }>('/api/v1/segments')])
      .then(([apps, groups]) => { if (active) { setItems(apps.items); setSegments(groups.items); } })
      .catch(err => { if (active) { setLoadFailed(true); setError(err instanceof Error ? err.message : 'Unable to load applications.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  /** Persist the form and keep it intact if the server rejects it. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    if (!form.name.trim() || !form.owner.trim() || !form.segmentId || !form.lifecycle || !form.criticality) { setError('Complete all fields.'); return; }
    setSaving(true);
    try {
      const item = await request<Application>(`/api/v1/applications${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      setItems(current => [...current.filter(row => row.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? 'Application updated.' : 'Application created.');
      setEditing(null); setForm(blank);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save application.'); }
    finally { setSaving(false); }
  }

  const filtered = items.filter(item => `${item.name} ${item.owner}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      <p className="eyebrow">EQIP / INVENTORY</p>
      <h1>Applications</h1>
      <p className="muted lead">Manage applications and their segment ownership.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? <p role="status">Loading applications…</p> : loadFailed ? (
        <button className="secondary" onClick={() => setVersion(value => value + 1)}>Retry loading</button>
      ) : <>
        <label htmlFor="application-search">Search applications or owners</label>
        <input id="application-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
        {items.length === 0 ? <p>No applications yet.</p> : filtered.length === 0 ? <p>No applications match your search.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Name</th><th scope="col">Segment</th><th scope="col">Owner</th><th scope="col">Lifecycle</th><th scope="col">Criticality</th><th scope="col">ID</th>{isAdmin && <th scope="col">Actions</th>}</tr></thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td><td>{segments.find(segment => segment.id === item.segmentId)?.name ?? item.segmentId}</td><td>{item.owner}</td><td>{item.lifecycle}</td><td>{item.criticality}</td><td>{item.id}</td>
                    {isAdmin && <td><button className="secondary" type="button" onClick={() => { setEditing(item); setForm({ name: item.name, segmentId: item.segmentId, owner: item.owner, lifecycle: item.lifecycle, criticality: item.criticality }); setError(''); setMessage(''); }}>Edit {item.name}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isAdmin && <section className="segment-form" aria-labelledby="application-form-title">
          <h2 id="application-form-title">{editing ? 'Edit application' : 'Create application'}</h2>
          {segments.length === 0 && <p>Create a segment before adding an application.</p>}
          <form onSubmit={save}>
            <label htmlFor="application-name">Name</label>
            <input id="application-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={120} required aria-required="true" />
            <label htmlFor="application-segment">Segment</label>
            <select id="application-segment" value={form.segmentId} onChange={event => setForm({ ...form, segmentId: event.target.value })} required aria-required="true">
              <option value="">Select a segment</option>
              {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
            <label htmlFor="application-owner">Owner</label>
            <input id="application-owner" value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })} maxLength={120} required aria-required="true" />
            <label htmlFor="application-lifecycle">Lifecycle</label>
            <select id="application-lifecycle" value={form.lifecycle} onChange={event => setForm({ ...form, lifecycle: event.target.value })} required aria-required="true">
              <option value="">Select lifecycle</option>
              {['Production', 'UAT', 'Pre-Prod', 'Retired'].map(value => <option key={value}>{value}</option>)}
            </select>
            <label htmlFor="application-criticality">Criticality</label>
            <select id="application-criticality" value={form.criticality} onChange={event => setForm({ ...form, criticality: event.target.value })} required aria-required="true">
              <option value="">Select criticality</option>
              {['High', 'Medium', 'Low'].map(value => <option key={value}>{value}</option>)}
            </select>
            <div className="form-actions">
              <button disabled={saving || segments.length === 0}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create application'}</button>
              {editing && <button className="secondary" type="button" onClick={() => { setEditing(null); setForm(blank); setError(''); }}>Cancel edit</button>}
            </div>
          </form>
        </section>}
      </>}
    </>
  );
}
