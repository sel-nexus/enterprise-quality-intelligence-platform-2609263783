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

describe('segments with file-backed SQLite', () => {
  let app: INestApplication;
  let dir: string;
  let service: SegmentsService;
  let db: Database;
  let token: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-segments-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(Database);
    service = app.get(SegmentsService);
    token = app.get(AuthService).login('admin@example.test', 'test-password-for-local-use').token;
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('creates, sorts and updates normalized fields, rejects duplicates and survives reopening', async () => {
    expect(service.list()).toEqual([]);
    const first = service.create({ name: ' Zeta ', owner: ' Owner ' });
    const second = service.create({ name: 'Alpha', owner: 'Other' });
    expect(first).toMatchObject({ name: 'Zeta', owner: 'Owner' });
    expect(service.list().map(item => item.name)).toEqual(['Alpha', 'Zeta']);
    expect(() => service.create({ name: 'zeta', owner: 'Other' })).toThrow('already exists');
    expect(() => service.update(first.id, { name: 'ALPHA', owner: 'Other' })).toThrow('already exists');
    expect(() => service.update('missing', { name: 'New', owner: 'Owner' })).toThrow('not found');
    expect(service.update(first.id, { name: 'Zeta', owner: 'New owner' }).owner).toBe('New owner');
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    expect(app.get(SegmentsService).list()).toEqual([second, { ...first, owner: 'New owner' }]);
  });

  it('rejects invalid service inputs', () => {
    for (const body of [null, [], {}, { name: ' ', owner: 'A' }, { name: 'A', owner: 3 }, { name: 'A'.repeat(121), owner: 'B' }, { name: 'A', owner: 'B', id: 'x' }]) {
      expect(() => service.create(body)).toThrow();
      expect(() => service.update('missing', body)).toThrow();
    }
  });

  it('enforces authentication, admin writes, validation, conflicts and missing ids over HTTP', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/v1/segments').expect(401);
    await request(server).post('/api/v1/segments').send({ name: 'A', owner: 'B' }).expect(401);
    await request(server).put('/api/v1/segments/missing').send({ name: 'A', owner: 'B' }).expect(401);
    const bearer = `Bearer ${token}`;
    await request(server).get('/api/v1/segments').set('Authorization', bearer).expect(200, { items: [] });
    await request(server).post('/api/v1/segments').set('Authorization', bearer).send({ name: '', owner: 'B' }).expect(400);
    const created = await request(server).post('/api/v1/segments').set('Authorization', bearer).send({ name: 'North', owner: 'Lee' }).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), name: 'North', owner: 'Lee' });
    await request(server).post('/api/v1/segments').set('Authorization', bearer).send({ name: 'north', owner: 'Lee' }).expect(409);
    await request(server).put('/api/v1/segments/missing').set('Authorization', bearer).send({ name: 'A', owner: 'B' }).expect(404);
    await request(server).put(`/api/v1/segments/${created.body.id}`).set('Authorization', bearer).send({ name: 'North', owner: 'New' }).expect(200).expect(({ body }) => expect(body.owner).toBe('New'));
    db.db.prepare("UPDATE users SET role='viewer'").run();
    await request(server).get('/api/v1/segments').set('Authorization', bearer).expect(200).expect(({ body }) => expect(body.items[0].owner).toBe('New'));
    await request(server).post('/api/v1/segments').set('Authorization', bearer).send({ name: 'B', owner: 'C' }).expect(403);
    await request(server).put(`/api/v1/segments/${created.body.id}`).set('Authorization', bearer).send({ name: 'B', owner: 'C' }).expect(403);
    db.db.prepare("UPDATE users SET status='disabled'").run();
    await request(server).get('/api/v1/segments').set('Authorization', bearer).expect(401);
  });
});
