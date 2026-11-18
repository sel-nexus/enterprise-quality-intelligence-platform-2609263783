import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService, verifyPassword } from '../src/auth/auth.service';
import { Database } from '../src/database';
import { SegmentsService } from '../src/segments/segments.service';
import { ApplicationsService } from '../src/applications/applications.service';
import { UsersService } from '../src/users/users.service';

describe('HTTP input and security boundaries with file-backed SQLite', () => {
  let app: INestApplication, dir: string, token: string, actor: string, segment: string;
  let db: Database;
  const user = () => ({ name: 'Pat', email: 'pat@example.test', password: 'a secure local password', role: 'viewer', status: 'active', segmentId: segment });
  const application = () => ({ name: 'Atlas', owner: 'Lee', segmentId: segment, lifecycle: 'Production', criticality: 'High' });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-security-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    db = app.get(Database);
    segment = app.get(SegmentsService).create({ name: 'North', owner: 'Sam' }).id;
    const login = app.get(AuthService).login('admin@example.test', 'test-password-for-local-use');
    actor = login.user.id; token = login.token;
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it.each(['segments', 'applications', 'users'] as const)('rejects invalid %s bodies on create and update without SQLite mutation', async resource => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    const valid: Record<string, unknown> = resource === 'segments' ? { name: 'East', owner: 'Lee' } : resource === 'applications' ? application() : user();
    const created = await request(server).post(`/api/v1/${resource}`).set('Authorization', auth).send(valid).expect(201);
    const before = db.db.prepare(`SELECT * FROM ${resource} ORDER BY id`).all();
    const audit = db.db.prepare('SELECT * FROM user_access_audit ORDER BY id').all();
    const fields = resource === 'segments' ? ['name', 'owner'] : resource === 'applications' ? ['name', 'owner', 'segmentId', 'lifecycle', 'criticality'] : ['name', 'email', 'password', 'role', 'status', 'segmentId'];
    const cases: { label: string; body: Record<string, unknown>; update: boolean }[] = [];
    for (const field of fields) {
      const omitted = { ...valid }; delete omitted[field];
      cases.push({ label: `missing ${field}`, body: omitted, update: field !== 'password' || resource !== 'users' });
      cases.push({ label: `wrong type ${field}`, body: { ...valid, [field]: 42 }, update: true });
      cases.push({ label: `blank ${field}`, body: { ...valid, [field]: '   ' }, update: true });
      const max = resource === 'users' && field === 'password' ? 1024 : resource === 'users' && field === 'email' ? 254 : resource === 'users' && field === 'segmentId' ? 128 : 120;
      cases.push({ label: `over limit ${field}`, body: { ...valid, [field]: 'x'.repeat(max + 1) }, update: true });
    }
    cases.push({ label: 'unexpected field', body: { ...valid, extra: true }, update: true });
    for (const { label, body, update } of cases) {
      const result = await request(server).post(`/api/v1/${resource}`).set('Authorization', auth).send(body);
      expect([label, result.status]).toEqual([label, 400]);
      if (update) {
        const response = await request(server).put(`/api/v1/${resource}/${created.body.id}`).set('Authorization', auth).send(body);
        expect([label, response.status]).toEqual([label, 400]);
      }
      expect(db.db.prepare(`SELECT * FROM ${resource} ORDER BY id`).all()).toEqual(before);
      expect(db.db.prepare('SELECT * FROM user_access_audit ORDER BY id').all()).toEqual(audit);
    }
    for (const method of ['post', 'put'] as const) {
      const path = `/api/v1/${resource}` + (method === 'put' ? `/${created.body.id}` : '');
      await request(server)[method](path).set('Authorization', auth).send({ ...valid, name: 'x'.repeat(110_000) }).expect(413);
      expect(db.db.prepare(`SELECT * FROM ${resource} ORDER BY id`).all()).toEqual(before);
      expect(db.db.prepare('SELECT * FROM user_access_audit ORDER BY id').all()).toEqual(audit);
    }
  });

  it('rejects invalid search values without changing applications', async () => {
    const existing = app.get(ApplicationsService).create(application());
    for (const query of ['search=' + 'x'.repeat(121), 'search=a&search=b', 'search%5Bfield%5D=value']) {
      await request(app.getHttpServer()).get(`/api/v1/applications?${query}`).set('Authorization', `Bearer ${token}`).expect(400);
      expect(app.get(ApplicationsService).list()).toEqual([existing]);
    }
  });

  it('rejects malformed paths and does not update any records', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    const before = db.db.prepare('SELECT * FROM segments').all();
    for (const path of ['/api/v1/segments/%', '/api/v1/segments/%E0%A4%A', '/api/v1/segments/id/extra']) {
      const response = await request(server).put(path).set('Authorization', auth).send({ name: 'East', owner: 'Lee' });
      expect([400, 404]).toContain(response.status);
      expect(db.db.prepare('SELECT * FROM segments').all()).toEqual(before);
    }
  });

  it('enforces NOT NULL directly in SQLite without persisting a failed row', () => {
    const before = db.db.prepare('SELECT * FROM segments').all();
    expect(() => db.db.prepare('INSERT INTO segments (id, name, owner) VALUES (?, ?, ?)').run('invalid', 'Missing owner', null)).toThrow(/NOT NULL constraint failed: segments.owner/);
    expect(db.db.prepare('SELECT * FROM segments').all()).toEqual(before);
  });

  it('treats SQL injection as data and cannot bypass login or change other rows', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    const payload = "' OR 1=1 --";
    const beforeUsers = db.db.prepare('SELECT * FROM users').all();
    await request(server).post('/api/v1/auth/login').send({ email: payload, password: 'anything-at-all' }).expect(401);
    await request(server).get('/api/v1/segments').set('Authorization', `Bearer ${payload}`).expect(401);
    const created = await request(server).post('/api/v1/segments').set('Authorization', auth).send({ name: payload, owner: "x'); DROP TABLE users;--" }).expect(201);
    expect(db.db.prepare('SELECT name, owner FROM segments WHERE id=?').get(created.body.id)).toEqual({ name: payload, owner: "x'); DROP TABLE users;--" });
    await request(server).put(`/api/v1/segments/${encodeURIComponent(payload)}`).set('Authorization', auth).send({ name: 'Changed', owner: 'Nobody' }).expect(404);
    expect(db.db.prepare('SELECT * FROM users').all()).toEqual(beforeUsers);
    expect(app.get(SegmentsService).list()).toHaveLength(2);
  });

  it('rejects HTML-like markup in either segment field on create and update without mutation', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    const before = db.db.prepare('SELECT * FROM segments ORDER BY id').all();
    const audit = db.db.prepare('SELECT * FROM user_access_audit ORDER BY id').all();
    for (const payload of ['<script>alert("stored-xss")</script>', '<img src=x onerror=alert(1)>', '<b>owner</b>', '<!-- comment -->', '<svg/onload=alert(1)>']) {
      for (const field of ['name', 'owner'] as const) {
        const body = { name: 'Safe name', owner: 'Safe owner', [field]: payload };
        await request(server).post('/api/v1/segments').set('Authorization', auth).send(body).expect(400);
        await request(server).put(`/api/v1/segments/${segment}`).set('Authorization', auth).send(body).expect(400);
        expect(db.db.prepare('SELECT * FROM segments ORDER BY id').all()).toEqual(before);
        expect(db.db.prepare('SELECT * FROM user_access_audit ORDER BY id').all()).toEqual(audit);
      }
    }
    // Ordinary punctuation remains data rather than being stripped or rejected.
    const accepted = await request(server).post('/api/v1/segments').set('Authorization', auth).send({ name: 'R&D > Support', owner: "O'Neil & Co." }).expect(201);
    expect(accepted.body).toMatchObject({ name: 'R&D > Support', owner: "O'Neil & Co." });
  });

  it('returns legacy stored XSS payload as JSON data, not an HTML response', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`, payload = '<script>alert("stored-xss")</script>';
    db.db.prepare('INSERT INTO segments (id, name, owner) VALUES (?, ?, ?)').run('legacy-xss', payload, 'Lee');
    expect(db.db.prepare('SELECT name FROM segments WHERE id=?').get('legacy-xss')).toEqual({ name: payload });
    const response = await request(server).get('/api/v1/segments').set('Authorization', auth).expect(200).expect('Content-Type', /application\/json/);
    expect(response.body.items).toContainEqual({ id: 'legacy-xss', name: payload, owner: 'Lee' });
  });

  it('updates the password hash and reauthenticates only with the new password', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    const created = app.get(UsersService).create(user(), actor);
    const oldHash = (db.db.prepare('SELECT password_hash FROM users WHERE id=?').get(created.id) as { password_hash: string }).password_hash;
    const password = 'a different secure password';
    await request(server).put(`/api/v1/users/${created.id}`).set('Authorization', auth).send({ ...user(), password }).expect(200);
    const hash = (db.db.prepare('SELECT password_hash FROM users WHERE id=?').get(created.id) as { password_hash: string }).password_hash;
    expect(hash).not.toBe(oldHash); expect(verifyPassword(password, hash)).toBe(true); expect(verifyPassword(user().password, hash)).toBe(false);
    await request(server).post('/api/v1/auth/login').send({ email: user().email, password: user().password }).expect(401);
    const login = await request(server).post('/api/v1/auth/login').send({ email: user().email, password }).expect(201);
    await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200).expect(({ body }) => expect(body.id).toBe(created.id));
  });
});
