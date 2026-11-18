# EQIP local portal foundation

This slice provides a local, nonproduction NestJS API, SQLite identity store, and React sign-in and portal shell. No enterprise SSO, user administration, inventory, reporting, or quality metrics are implemented. This is not production-ready.

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

For the browser spec, start both local servers with a disposable SQLite file and the chosen local bootstrap credentials, then run from `frontend`:

```sh
E2E_ADMIN_EMAIL='your-local-email' E2E_ADMIN_PASSWORD='your-local-password' node node_modules/@playwright/test/cli.js test
```

Install Playwright Chromium using `node node_modules/@playwright/test/cli.js install chromium` if needed. The E2E spec uses the live API and must never target production.

## Security and operational limitations

Local authentication is explicitly disabled when `NODE_ENV=production` and is not a substitute for enterprise SSO or approved claims. Access tokens expire after one hour; sign-out clears the cookie but cannot revoke an already copied token. The cookie is HttpOnly and SameSite=Strict but not Secure because local HTTP is used; do not expose this stack to a network. Login also returns a bearer token for API use, so browser JavaScript can access that response: XSS can steal it. There is no MFA, rate limiting, account recovery, centralized revocation, audit trail, TLS, CSRF architecture review, or production hardening. SQLite concurrency, encryption, backup/recovery and enterprise suitability have not been validated. Use only synthetic, non-sensitive local data; do not store PHI. Review security and accessibility before any deployment.
