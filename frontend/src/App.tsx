/** Restore an existing local session and switch between access and portal. */
import { useEffect, useState } from 'react';
import { logout, me, type User } from './api';
import Login from './Login';
import Shell from './Shell';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    me().then(value => { if (active) setUser(value); }).catch(() => { if (active) setUser(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  /** Clear the session only after the server confirms sign-out. */
  async function signOut() {
    try { await logout(); setUser(null); setError(''); }
    catch { setError('Unable to sign out. Please try again.'); }
  }

  if (loading) return <main className="loading" aria-live="polite">Checking your session…</main>;
  return user ? <Shell user={user} onLogout={signOut} error={error} /> : <Login onLogin={setUser} />;
}
