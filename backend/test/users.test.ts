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
import { UsersService } from '../src/users/users.service';

describe('user administration with file SQLite', () => {
  let app: INestApplication, dir: string, token: string, actor: string, segment: string;
  let db: Database, service: UsersService;
  const values = () => ({ name: 'Pat', email: 'pat@example.test', password: 'a secure local password', role: 'viewer', status: 'active', segmentId: segment });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-users-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    db = app.get(Database); service = app.get(UsersService);
    segment = app.get(SegmentsService).create({ name: 'North', owner: 'Sam' }).id;
    const login = app.get(AuthService).login('admin@example.test', 'test-password-for-local-use');
    actor = login.user.id; token = login.token;
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('hashes passwords, persists changes and appends immutable actor-attributed access events', async () => {
    const created = service.create(values(), actor);
    expect(created).toEqual({ id: expect.any(String), name: 'Pat', email: 'pat@example.test', role: 'viewer', status: 'active', segmentId: segment });
    const stored = db.db.prepare('SELECT password_hash FROM users WHERE id=?').get(created.id) as { password_hash: string };
    expect(stored.password_hash).not.toContain(values().password);
    expect(verifyPassword(values().password, stored.password_hash)).toBe(true);
    const changed = service.update(created.id, { name: 'Pat Two', email: 'PAT@example.test', role: 'auditor', status: 'disabled', segmentId: null }, actor);
    expect(changed.email).toBe('pat@example.test');
    const events = db.db.prepare('SELECT actor_id,field,old_value,new_value,occurred_at FROM user_access_audit WHERE user_id=? ORDER BY rowid').all(created.id) as unknown as { actor_id: string; field: string; old_value: string | null; new_value: string | null; occurred_at: string }[];
    expect(events.map(e => [e.field, e.old_value, e.new_value])).toEqual([['role', null, 'viewer'], ['status', null, 'active'], ['segmentId', null, segment], ['role', 'viewer', 'auditor'], ['status', 'active', 'disabled'], ['segmentId', segment, null]]);
    expect(events.every(e => e.actor_id === actor && !Number.isNaN(Date.parse(e.occurred_at)))).toBe(true);
    expect(() => db.db.exec('UPDATE user_access_audit SET actor_id = user_id')).toThrow('immutable');
    expect(() => db.db.exec('DELETE FROM user_access_audit')).toThrow('immutable');
    expect(() => db.db.exec('INSERT OR REPLACE INTO user_access_audit SELECT * FROM user_access_audit LIMIT 1')).toThrow('immutable');
    expect(() => db.db.prepare('DELETE FROM segments WHERE id=?').run(segment)).not.toThrow();
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    expect(app.get(UsersService).list()).toContainEqual(changed);
    expect(app.get(Database).db.prepare('SELECT count(*) AS count FROM user_access_audit').get()).toEqual({ count: 6 });
  });

  it('validates, preserves integrity and rejects last-admin changes atomically', () => {
    for (const body of [null, [], {}, { ...values(), name: ' ' }, { ...values(), email: 'bad' }, { ...values(), password: 'short' }, { ...values(), role: 'root' }, { ...values(), status: 'unknown' }, { ...values(), segmentId: 1 }, { ...values(), extra: 1 }]) {
      expect(() => service.create(body, actor)).toThrow();
    }
    expect(() => service.create({ ...values(), segmentId: 'missing' }, actor)).toThrow('Unknown segment');
    const user = service.create(values(), actor);
    expect(() => service.create({ ...values(), email: 'PAT@example.test' }, actor)).toThrow('already exists');
    expect(() => db.db.prepare('DELETE FROM segments WHERE id=?').run(segment)).toThrow();
    expect(() => service.update('missing', values(), actor)).toThrow('not found');
    const admin = service.list().find(row => row.id === actor)!;
    const body = { name: admin.name, email: admin.email, role: admin.role, status: admin.status, segmentId: admin.segmentId };
    const before = db.db.prepare('SELECT count(*) AS count FROM user_access_audit').get();
    expect(() => service.update(actor, { ...body, role: 'viewer' }, actor)).toThrow('last active');
    expect(() => service.update(actor, { ...body, status: 'disabled' }, actor)).toThrow('last active');
    expect(db.db.prepare('SELECT count(*) AS count FROM user_access_audit').get()).toEqual(before);
    expect(service.list().find(row => row.id === actor)).toEqual(admin);
    expect(() => service.update(user.id, values(), user.id)).toThrow('Administrator');
    const second = service.create({ ...values(), email: 'other@example.test', role: 'admin' }, actor);
    expect(service.update(actor, { ...body, role: 'viewer' }, actor).role).toBe('viewer');
    expect(() => service.update(second.id, { ...values(), email: 'other@example.test', status: 'disabled', role: 'admin' }, actor)).toThrow('Administrator');
  });

  it('enforces HTTP authentication, role and live status changes', async () => {
    const server = app.getHttpServer(), auth = `Bearer ${token}`;
    await request(server).get('/api/v1/users').expect(401);
    await request(server).post('/api/v1/users').send(values()).expect(401);
    await request(server).put('/api/v1/users/x').send(values()).expect(401);
    await request(server).post('/api/v1/users').set('Authorization', auth).send({ ...values(), segmentId: 'missing' }).expect(400);
    const created = await request(server).post('/api/v1/users').set('Authorization', auth).send(values()).expect(201);
    expect(created.body.password_hash).toBeUndefined(); expect(created.body.password).toBeUndefined();
    const viewerToken = app.get(AuthService).login(values().email, values().password).token;
    for (const method of ['get', 'post', 'put'] as const) {
      const path = method === 'put' ? `/api/v1/users/${created.body.id}` : '/api/v1/users';
      await request(server)[method](path).set('Authorization', `Bearer ${viewerToken}`).send(method === 'get' ? undefined : values()).expect(403);
    }
    await request(server).get('/api/v1/users').set('Authorization', auth).expect(200).expect(({ body }) => expect(JSON.stringify(body)).not.toContain('password'));
    await request(server).put(`/api/v1/users/${created.body.id}`).set('Authorization', auth).send({ ...values(), status: 'disabled' }).expect(200);
    await request(server).get('/api/v1/users').set('Authorization', `Bearer ${viewerToken}`).expect(401);
    await request(server).put('/api/v1/users/missing').set('Authorization', auth).send(values()).expect(404);
    await request(server).put(`/api/v1/users/${actor}`).set('Authorization', auth).send({ name: 'Admin', email: 'admin@example.test', role: 'viewer', status: 'active', segmentId: null }).expect(409);
  });
});
