/** Display and maintain the authenticated segment inventory. */
import { useEffect, useState, type FormEvent } from 'react';

interface Segment { id: string; name: string; owner: string }
interface Props { isAdmin: boolean }
const base = import.meta.env.VITE_API_BASE || '';

/** Request segment data with the existing browser session. */
async function segmentRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (response.status === 403) throw new Error('You do not have permission to change segments.');
    if (response.status === 409) throw new Error('A segment with this name already exists.');
    if (response.status === 404) throw new Error('This segment no longer exists.');
    if (response.status === 400) throw new Error('Enter a name and owner of at most 120 characters.');
    throw new Error('Unable to complete the request. Please try again.');
  }
  return response.json() as Promise<T>;
}

export default function Segments({ isAdmin }: Props) {
  const [items, setItems] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setLoadFailed(false);
    segmentRequest<{ items: Segment[] }>('/api/v1/segments')
      .then(result => { if (active) setItems(result.items); })
      .catch(err => { if (active) { setLoadFailed(true); setError(err instanceof Error ? err.message : 'Unable to load segments.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  /** Save a new or existing segment and retain the form on failure. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!name.trim() || !owner.trim()) {
      setError('Enter a name and owner.');
      return;
    }
    setSaving(true);
    try {
      const segment = await segmentRequest<Segment>(`/api/v1/segments${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), owner: owner.trim() })
      });
      setItems(current => [...current.filter(item => item.id !== segment.id), segment].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? 'Segment updated.' : 'Segment created.');
      setEditing(null);
      setName('');
      setOwner('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the segment.');
    } finally { setSaving(false); }
  }

  return (
    <>
      <p className="eyebrow">EQIP / INVENTORY</p>
      <h1>Segments</h1>
      <p className="muted lead">Manage the segments and owners in your inventory.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? <p role="status">Loading segments…</p> : loadFailed ? (
        <button className="secondary" onClick={() => setVersion(value => value + 1)}>Retry loading</button>
      ) : items.length === 0 ? <p>No segments yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Owner</th><th scope="col">ID</th>{isAdmin && <th scope="col">Actions</th>}</tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>{item.name}</td><td>{item.owner}</td><td>{item.id}</td>
                  {isAdmin && <td><button className="secondary" type="button" onClick={() => { setEditing(item); setName(item.name); setOwner(item.owner); setError(''); setMessage(''); }}>Edit {item.name}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && (
        <section className="segment-form" aria-labelledby="segment-form-title">
          <h2 id="segment-form-title">{editing ? 'Edit segment' : 'Create segment'}</h2>
          <form onSubmit={save}>
            <label htmlFor="segment-name">Name</label>
            <input id="segment-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required aria-required="true" />
            <label htmlFor="segment-owner">Owner</label>
            <input id="segment-owner" value={owner} onChange={event => setOwner(event.target.value)} maxLength={120} required aria-required="true" />
            <div className="form-actions">
              <button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create segment'}</button>
              {editing && <button className="secondary" type="button" onClick={() => { setEditing(null); setName(''); setOwner(''); setError(''); }}>Cancel edit</button>}
            </div>
          </form>
        </section>
      )}
    </>
  );
}
