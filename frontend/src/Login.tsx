/** Present the local administrator sign-in form. */
import { useState, type FormEvent } from 'react';
import { login, type User } from './api';

interface Props { onLogin: (user: User) => void }

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** Submit credentials and retain failures on the form. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try { onLogin(await login(email, password)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); }
    finally { setLoading(false); }
  }

  return (
    <main className="login-layout">
      <section className="login-intro" aria-labelledby="intro-title">
        <div className="wordmark">EQIP<span>.</span></div>
        <p className="eyebrow">Enterprise Quality Intelligence Platform</p>
        <h1 id="intro-title">A clearer view of quality.</h1>
        <p>One place for your organization’s quality intelligence.</p>
        <p className="intro-note">LOCAL DEVELOPMENT ENVIRONMENT</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <p className="eyebrow">PORTAL ACCESS</p>
          <h2 id="login-title">Sign in</h2>
          <p className="muted">Use the local credentials configured by your administrator.</p>
          <form onSubmit={submit}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" required aria-required="true" value={email} onChange={e => setEmail(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" required aria-required="true" value={password} onChange={e => setPassword(e.target.value)} />
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="footnote">Local access only. Enterprise identity integration is not configured.</p>
        </div>
      </section>
    </main>
  );
}
