import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Database } from '../src/database';
import { SegmentsService } from '../src/segments/segments.service';
import { ApplicationsService } from '../src/applications/applications.service';

describe('applications with file-backed SQLite', () => {
  let app: INestApplication, dir: string, token: string, segment: string;
  let db: Database, service: ApplicationsService;
  const data = () => ({ name: 'Atlas', owner: 'Lee', segmentId: segment, lifecycle: 'Production', criticality: 'High' });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-applications-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    db = app.get(Database); service = app.get(ApplicationsService);
    segment = app.get(SegmentsService).create({ name: 'North', owner: 'Sam' }).id;
    token = app.get(AuthService).login('admin@example.test', 'test-password-for-local-use').token;
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('persists, searches, updates, and enforces integrity after reopening', async () => {
    expect(service.list()).toEqual([]);
    const first = service.create({ ...data(), name: ' Atlas ' });
    expect(service.list('LEE')).toEqual([first]);
    expect(service.list('missing')).toEqual([]);
    expect(() => service.create({ ...data(), name: 'ATLAS' })).toThrow('already exists');
    expect(() => service.update('missing', data())).toThrow('not found');
    expect(() => service.create({ ...data(), segmentId: 'missing' })).toThrow('Unknown segment');
    expect(() => db.db.prepare('DELETE FROM segments WHERE id = ?').run(segment)).toThrow();
    const updated = service.update(first.id, { ...data(), owner: 'Pat', lifecycle: 'UAT' });
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    expect(app.get(ApplicationsService).list()).toEqual([updated]);
  });

  it('rejects malformed fields, enums and unexpected properties', () => {
    for (const body of [null, [], {}, { ...data(), owner: ' ' }, { ...data(), name: 3 }, { ...data(), name: 'a'.repeat(121) }, { ...data(), lifecycle: 'invalid' }, { ...data(), criticality: 'invalid' }, { ...data(), id: 'x' }]) {
      expect(() => service.create(body)).toThrow();
      expect(() => service.update('missing', body)).toThrow();
    }
  });

  it('enforces HTTP authentication, role restrictions and validation', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/v1/applications').expect(401);
    await request(server).post('/api/v1/applications').send(data()).expect(401);
    await request(server).put('/api/v1/applications/missing').send(data()).expect(401);
    const auth = `Bearer ${token}`;
    await request(server).get('/api/v1/applications').set('Authorization', auth).expect(200, { items: [] });
    await request(server).post('/api/v1/applications').set('Authorization', auth).send({ ...data(), segmentId: 'missing' }).expect(400);
    await request(server).post('/api/v1/applications').set('Authorization', auth).send({ ...data(), lifecycle: 'unknown' }).expect(400);
    const created = await request(server).post('/api/v1/applications').set('Authorization', auth).send(data()).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), ...data() });
    await request(server).post('/api/v1/applications').set('Authorization', auth).send({ ...data(), name: 'ATLAS' }).expect(409);
    await request(server).put('/api/v1/applications/missing').set('Authorization', auth).send(data()).expect(404);
    await request(server).put(`/api/v1/applications/${created.body.id}`).set('Authorization', auth).send({ ...data(), owner: 'Pat' }).expect(200);
    await request(server).get('/api/v1/applications?search=pat').set('Authorization', auth).expect(200).expect(({ body }) => expect(body.items[0].owner).toBe('Pat'));
    db.db.prepare("UPDATE users SET role='viewer'").run();
    await request(server).get('/api/v1/applications').set('Authorization', auth).expect(403);
    await request(server).post('/api/v1/applications').set('Authorization', auth).send(data()).expect(403);
    await request(server).put(`/api/v1/applications/${created.body.id}`).set('Authorization', auth).send(data()).expect(403);
    db.db.prepare("UPDATE users SET status='disabled'").run();
    await request(server).get('/api/v1/applications').set('Authorization', auth).expect(401);
  });
});
