/** Render the authenticated portal foundation without unfinished feature links. */
import type { User } from './api';

interface Props { user: User; onLogout: () => void; error: string }

export default function Shell({ user, onLogout, error }: Props) {
  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">EQIP<span>.</span></div>
        <p className="rail-label">QUALITY INTELLIGENCE</p>
        <nav aria-label="Portal">
          <a href="/" aria-current="page">Portal home</a>
        </nav>
        <p className="rail-footer">LOCAL DEVELOPMENT</p>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Portal home</span>
          <div className="account">
            <span>{user.name}</span>
            <button className="secondary" onClick={onLogout}>Sign out</button>
          </div>
        </header>
        <main className="workspace-main">
          <p className="eyebrow">EQIP / PORTAL HOME</p>
          <h1>Welcome, {user.name}.</h1>
          <p className="muted lead">Your local portal session is active.</p>
          <section className="account-summary" aria-labelledby="account-title">
            <h2 id="account-title">Your access</h2>
            <dl>
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Role</dt><dd>{user.role}</dd></div>
              <div><dt>Status</dt><dd>{user.status}</dd></div>
            </dl>
          </section>
          {error && <p className="error" role="alert">{error}</p>}
        </main>
      </div>
    </div>
  );
}
