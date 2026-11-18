/** Display and maintain the local administrator-only user inventory. */
import { useEffect, useState, type FormEvent } from 'react';

interface Account { id: string; name: string; email: string; role: string; status: string; segmentId: string | null }
interface Segment { id: string; name: string }
interface Form { name: string; email: string; role: string; status: string; segmentId: string; password: string }
const base = import.meta.env.VITE_API_BASE || '';
const blank: Form = { name: '', email: '', role: 'viewer', status: 'active', segmentId: '', password: '' };
const roles = ['admin', 'executive', 'segment_leader', 'qe_leader', 'qe_manager', 'engineer', 'release_manager', 'auditor', 'vendor', 'viewer'];

/** Request user data through the existing browser session. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (response.status === 403) throw new Error('Administrator access required.');
    if (response.status === 409) {
      const result = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(result.message || 'The request conflicts with existing data.');
    }
    if (response.status === 400) throw new Error('Check the fields and select an existing segment.');
    if (response.status === 404) throw new Error('This user no longer exists.');
    throw new Error('Unable to complete the request. Please try again.');
  }
  return response.json() as Promise<T>;
}

/** Render the user list and creation or editing form. */
export default function Users() {
  const [items, setItems] = useState<Account[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false); setError('');
    Promise.all([request<{ items: Account[] }>('/api/v1/users'), request<{ items: Segment[] }>('/api/v1/segments')])
      .then(([users, groups]) => { if (active) { setItems(users.items); setSegments(groups.items); } })
      .catch(err => { if (active) { setFailed(true); setError(err instanceof Error ? err.message : 'Unable to load users.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  /** Save the form without clearing it on failure. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    if (!form.name.trim() || !form.email.trim() || (!editing && form.password.length < 12) || (form.password && form.password.length < 12)) {
      setError('Enter a name, email and password of at least 12 characters.'); return;
    }
    setSaving(true);
    try {
      const body = { name: form.name, email: form.email, role: form.role, status: form.status, segmentId: form.segmentId || null, ...(form.password ? { password: form.password } : {}) };
      const item = await request<Account>(`/api/v1/users${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      setItems(current => [...current.filter(row => row.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? 'User updated.' : 'User created.');
      setEditing(null); setForm(blank);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save user.'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <p className="eyebrow">EQIP / ADMINISTRATION</p>
      <h1>Users</h1>
      <p className="muted lead">Manage local accounts and access assignments.</p>
      <p className="muted">Segment assignment does not grant application access until enterprise claims are configured.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? <p role="status">Loading users…</p> : failed ? (
        <button className="secondary" onClick={() => setVersion(value => value + 1)}>Retry loading</button>
      ) : <>
        {items.length === 0 ? <p>No users yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Segment</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td><td>{item.email}</td><td>{item.role}</td><td>{item.status}</td><td>{segments.find(segment => segment.id === item.segmentId)?.name ?? (item.segmentId || 'Unassigned')}</td>
                    <td><button className="secondary" type="button" onClick={() => { setEditing(item); setForm({ ...item, segmentId: item.segmentId || '', password: '' }); setError(''); setMessage(''); }}>Edit {item.name}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <section className="segment-form" aria-labelledby="user-form-title">
          <h2 id="user-form-title">{editing ? `Edit ${editing.name}` : 'Create user'}</h2>
          <form onSubmit={save}>
            <label htmlFor="user-name">Name</label>
            <input id="user-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} required aria-required="true" />
            <label htmlFor="user-email">Email</label>
            <input id="user-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} maxLength={254} required aria-required="true" />
            <label htmlFor="user-password">{editing ? 'New password (optional)' : 'Password'}</label>
            <input id="user-password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={12} maxLength={1024} required={!editing} aria-required={!editing} />
            <label htmlFor="user-role">Role</label>
            <select id="user-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {roles.map(role => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}
            </select>
            <label htmlFor="user-status">Status</label>
            <select id="user-status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="active">active</option><option value="disabled">disabled</option>
            </select>
            <label htmlFor="user-segment">Segment</label>
            <select id="user-segment" value={form.segmentId} onChange={e => setForm({ ...form, segmentId: e.target.value })}>
              <option value="">Unassigned</option>
              {segments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
            <div className="form-actions">
              <button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button>
              {editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setForm(blank); setError(''); }}>Cancel edit</button>}
            </div>
          </form>
        </section>
      </>}
    </>
  );
}
