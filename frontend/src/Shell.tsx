/** Render the authenticated portal foundation without unfinished feature links. */
import type { User } from './api';
import Segments from './Segments';
import Applications from './Applications';
import Users from './Users';

interface Props { user: User; onLogout: () => void; error: string; page: 'home' | 'segments' | 'applications' | 'users' }

export default function Shell({ user, onLogout, error, page }: Props) {
  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">EQIP<span>.</span></div>
        <p className="rail-label">QUALITY INTELLIGENCE</p>
        <nav aria-label="Portal">
          <a href="/" aria-current={page === 'home' ? 'page' : undefined}>Portal home</a>
          <a href="/segments" aria-current={page === 'segments' ? 'page' : undefined}>Segments</a>
          <a href="/applications" aria-current={page === 'applications' ? 'page' : undefined}>Applications</a>
          {user.role === 'admin' && <a href="/users" aria-current={page === 'users' ? 'page' : undefined}>Users</a>}
        </nav>
        <p className="rail-footer">LOCAL DEVELOPMENT</p>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>{page === 'home' ? 'Portal home' : page === 'segments' ? 'Segments' : page === 'applications' ? 'Applications' : 'Users'}</span>
          <div className="account">
            <span>{user.name}</span>
            <button className="secondary" onClick={onLogout}>Sign out</button>
          </div>
        </header>
        <main className="workspace-main">
          {page === 'segments' ? <Segments isAdmin={user.role === 'admin'} /> : page === 'applications' ? <Applications isAdmin={user.role === 'admin'} /> : page === 'users' ? (user.role === 'admin' ? <Users /> : <p role="alert">Administrator access required.</p>) : <>
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
          </>}
          {error && <p className="error" role="alert">{error}</p>}
        </main>
      </div>
    </div>
  );
}
