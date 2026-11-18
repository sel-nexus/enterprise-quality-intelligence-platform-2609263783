import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Database } from '../src/database';

describe('cross-feature HTTP integration with file-backed SQLite', () => {
  let app: INestApplication;
  let dir: string;
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    previousEnv = { ...process.env };
    dir = mkdtempSync(join(tmpdir(), 'eqip-integration-'));
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'),
      AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin',
      BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    try {
      if (app) await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      process.env = previousEnv;
    }
  });

  it('propagates inventory and user status through reports, authentication and persisted references', async () => {
    let server = app.getHttpServer();
    const login = await request(server).post('/api/v1/auth/login').send({ email: 'admin@example.test', password: 'test-password-for-local-use' }).expect(201);
    const auth = `Bearer ${login.body.token}`;
    const adminId = login.body.user.id;

    const initial = await request(server).get('/api/v1/overview').set('Authorization', auth).expect(200);
    expect(initial.body).toEqual({ counts: { segments: 0, applications: 0, activeUsers: 1 }, qualityScore: null });
    const initialReport = await request(server).get('/api/v1/overview/report.csv').set('Authorization', auth).expect(200);
    expect(initialReport.text).toContain('"Segments","0"\r\n"Applications","0"\r\n"Active users","1"');

    const segment = await request(server).post('/api/v1/segments').set('Authorization', auth).send({ name: 'North', owner: 'Sam' }).expect(201);
    const application = await request(server).post('/api/v1/applications').set('Authorization', auth).send({ name: 'Atlas', owner: 'Lee', segmentId: segment.body.id, lifecycle: 'Production', criticality: 'High' }).expect(201);
    const userFields = { name: 'Pat', email: 'pat@example.test', password: 'a secure local password', role: 'viewer', status: 'active', segmentId: segment.body.id };
    const user = await request(server).post('/api/v1/users').set('Authorization', auth).send(userFields).expect(201);
    expect(application.body.segmentId).toBe(segment.body.id);
    expect(user.body.segmentId).toBe(segment.body.id);

    const userLogin = await request(server).post('/api/v1/auth/login').send({ email: userFields.email, password: userFields.password }).expect(201);
    const userAuth = `Bearer ${userLogin.body.token}`;
    await request(server).get('/api/v1/auth/me').set('Authorization', userAuth).expect(200).expect(({ body }) => expect(body.id).toBe(user.body.id));
    const populated = await request(server).get('/api/v1/overview').set('Authorization', auth).expect(200);
    expect(populated.body).toEqual({ counts: { segments: 1, applications: 1, activeUsers: 2 }, qualityScore: null });
    const populatedReport = await request(server).get('/api/v1/overview/report.csv').set('Authorization', auth).expect(200);
    expect(populatedReport.text).toContain('"Segments","1"\r\n"Applications","1"\r\n"Active users","2"');

    await request(server).put(`/api/v1/users/${user.body.id}`).set('Authorization', auth).send({ ...userFields, status: 'disabled' }).expect(200);
    await request(server).get('/api/v1/auth/me').set('Authorization', userAuth).expect(401);
    await request(server).get('/api/v1/segments').set('Authorization', userAuth).expect(401);
    await request(server).post('/api/v1/auth/login').send({ email: userFields.email, password: userFields.password }).expect(401);
    const disabled = await request(server).get('/api/v1/overview').set('Authorization', auth).expect(200);
    expect(disabled.body).toEqual({ counts: { segments: 1, applications: 1, activeUsers: 1 }, qualityScore: null });
    const disabledReport = await request(server).get('/api/v1/overview/report.csv').set('Authorization', auth).expect(200);
    expect(disabledReport.text).toContain('"Segments","1"\r\n"Applications","1"\r\n"Active users","1"');

    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    const db = app.get(Database).db;
    expect(db.prepare('SELECT id, segment_id FROM applications WHERE id=?').get(application.body.id)).toEqual({ id: application.body.id, segment_id: segment.body.id });
    expect(db.prepare('SELECT id, segment_id, status FROM users WHERE id=?').get(user.body.id)).toEqual({ id: user.body.id, segment_id: segment.body.id, status: 'disabled' });
    expect(db.prepare('SELECT user_id, actor_id, old_value, new_value FROM user_access_audit WHERE user_id=? AND field=? ORDER BY rowid').all(user.body.id, 'status')).toEqual([
      { user_id: user.body.id, actor_id: adminId, old_value: null, new_value: 'active' },
      { user_id: user.body.id, actor_id: adminId, old_value: 'active', new_value: 'disabled' },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    await request(server).get('/api/v1/overview').set('Authorization', auth).expect(200).expect(({ body }) => expect(body.counts).toEqual({ segments: 1, applications: 1, activeUsers: 1 }));
    await request(server).get('/api/v1/auth/me').set('Authorization', userAuth).expect(401);
  });

  it('rejects missing upstream segments and missing records without orphaned or partial writes', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/api/v1/auth/login').send({ email: 'admin@example.test', password: 'test-password-for-local-use' }).expect(201);
    const auth = `Bearer ${login.body.token}`;
    const segment = await request(server).post('/api/v1/segments').set('Authorization', auth).send({ name: 'North', owner: 'Sam' }).expect(201);
    const applicationFields = { name: 'Atlas', owner: 'Lee', segmentId: segment.body.id, lifecycle: 'Production', criticality: 'High' };
    const userFields = { name: 'Pat', email: 'pat@example.test', password: 'a secure local password', role: 'viewer', status: 'active', segmentId: segment.body.id };
    const application = await request(server).post('/api/v1/applications').set('Authorization', auth).send(applicationFields).expect(201);
    const user = await request(server).post('/api/v1/users').set('Authorization', auth).send(userFields).expect(201);
    const db = app.get(Database).db;
    const applicationsBefore = db.prepare('SELECT * FROM applications ORDER BY id').all();
    const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();
    const auditBefore = db.prepare('SELECT * FROM user_access_audit ORDER BY id').all();

    await request(server).post('/api/v1/applications').set('Authorization', auth).send({ ...applicationFields, name: 'Missing dependency', segmentId: 'missing' }).expect(400);
    await request(server).post('/api/v1/users').set('Authorization', auth).send({ ...userFields, email: 'other@example.test', segmentId: 'missing' }).expect(400);
    await request(server).put(`/api/v1/applications/${application.body.id}`).set('Authorization', auth).send({ ...applicationFields, segmentId: 'missing' }).expect(400);
    await request(server).put(`/api/v1/users/${user.body.id}`).set('Authorization', auth).send({ ...userFields, status: 'disabled', segmentId: 'missing' }).expect(400);
    await request(server).put('/api/v1/applications/missing').set('Authorization', auth).send(applicationFields).expect(404);
    await request(server).put('/api/v1/users/missing').set('Authorization', auth).send(userFields).expect(404);

    expect(db.prepare('SELECT * FROM applications ORDER BY id').all()).toEqual(applicationsBefore);
    expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(usersBefore);
    expect(db.prepare('SELECT * FROM user_access_audit ORDER BY id').all()).toEqual(auditBefore);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.prepare('DELETE FROM segments WHERE id=?').run(segment.body.id)).toThrow(/FOREIGN KEY constraint failed/);
    const overview = await request(server).get('/api/v1/overview').set('Authorization', auth).expect(200);
    expect(overview.body.counts).toEqual({ segments: 1, applications: 1, activeUsers: 2 });
  });
});
