import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Shell from './Shell';

afterEach(cleanup);

describe('portal navigation by role', () => {
  it.each([
    { role: 'admin', overview: true, applications: true, users: true },
    { role: 'executive', overview: true, applications: false, users: false },
    { role: 'viewer', overview: false, applications: false, users: false },
  ])('shows only accessible links for $role', ({ role, overview, applications, users }) => {
    render(
      <Shell
        user={{ id: '1', name: 'Test User', email: 'user@example.test', role, status: 'active' }}
        onLogout={() => {}}
        error=""
        page="home"
      />
    );

    const nav = within(screen.getByRole('navigation', { name: 'Portal' }));
    expect(nav.getByRole('link', { name: 'Portal home' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Segments' })).toHaveAttribute('href', '/segments');
    for (const [name, href, allowed] of [
      ['Executive overview', '/overview', overview],
      ['Applications', '/applications', applications],
      ['Users', '/users', users],
    ] as const) {
      const link = nav.queryByRole('link', { name });
      if (allowed) expect(link).toHaveAttribute('href', href);
      else expect(link).not.toBeInTheDocument();
    }
  });
});
