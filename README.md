# EQIP local portal foundation

This slice provides a local, nonproduction NestJS API, SQLite identity store, inventory and user administration, and a React portal. Enterprise SSO and quality metrics are not implemented. This is not production-ready.

Administrators and executives can view and export enterprise-wide segment, application, and active-user counts through the overview and its internal CSV report. The report contains fixed aggregates only, not individual user records or application details; quality scores are unavailable. Other roles cannot access either overview endpoint. User and application inventory access remains administrator-only; the overview grant does not extend to those details.

## Local setup

Requires Node 24 (the backend uses `node:sqlite`) and npm. Copy `backend/.env.example` to `backend/.env`; generate a unique random `AUTH_SECRET` of at least 32 characters and set a unique local administrator email, name, and password (at least 12 characters). Example placeholder values are deliberately rejected. Never commit `.env` or actual credentials. Bootstrap occurs only when the identity table is empty; changing bootstrap variables later does not reset an existing account. To reset a disposable development environment, stop the server and deliberately remove its SQLite file (or Docker volume); this permanently removes its data.

```sh
cd backend
npm install --bin-links=false
npm run build
npm start
```

In a second terminal:

```sh
cd frontend
npm install --bin-links=false
npm run dev
```

Open http://127.0.0.1:5173 and sign in with the configured bootstrap identity. The API binds to loopback by default (`HOST` controls the bind address). Vite proxies `/api` to port 3000; set `VITE_PROXY_TARGET` if needed. The frontend defaults to same-origin API requests. `GET /api/health` is public; `POST /api/v1/auth/login` accepts email and password; `GET /api/v1/auth/me` requires the signed session cookie or bearer token; `POST /api/v1/auth/logout` clears the browser cookie.

For Docker, after configuring `backend/.env`, run `docker compose up --build` and open http://127.0.0.1:8080. SQLite is persisted in the `eqip-data` volume; the nginx frontend proxies API requests to the backend service. Bindings are loopback-only on the host.

## Tests

```sh
cd backend && npm test -- auth
cd frontend && npm test
```

For browser tests, install dependencies in both tiers and Playwright Chromium (`cd frontend && node node_modules/@playwright/test/cli.js install chromium`). Then run from `frontend`:

```sh
node node_modules/@playwright/test/cli.js test
```

Playwright builds and starts two isolated local backend/frontend pairs (ports 4300/4173 and 4301/4174) with fresh temporary SQLite databases. It generates disposable administrator credentials and an authentication secret in memory; do not use production credentials or data. All four ports must be free. The second pair is reserved for the fresh-database journey. Servers and temporary databases are removed on normal shutdown. Test screenshots are saved under `frontend/test-results/`, including mobile, loading, and empty states; `frontend/e2e-results.json` records results.

## Security and operational limitations

Local authentication is explicitly disabled when `NODE_ENV=production` and is not a substitute for enterprise SSO or approved claims. Access tokens expire after one hour; sign-out clears the cookie but cannot revoke an already copied token. The cookie is HttpOnly and SameSite=Strict but not Secure because local HTTP is used; do not expose this stack to a network. Login also returns a bearer token for API use, so browser JavaScript can access that response: XSS can steal it. There is no MFA, rate limiting, account recovery, centralized revocation, audit trail, TLS, CSRF architecture review, or production hardening. SQLite concurrency, encryption, backup/recovery and enterprise suitability have not been validated. Use only synthetic, non-sensitive local data; do not store PHI. Review security and accessibility before any deployment.
