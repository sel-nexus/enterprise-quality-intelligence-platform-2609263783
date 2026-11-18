import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, INestApplication, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AuthService, hashPassword, verifyPassword } from '../src/auth/auth.service';
import { AuthGuard, Roles } from '../src/auth/auth.guard';
import { Database } from '../src/database';

@Controller('test-role')
class RoleTestController {
  @Get()
  @UseGuards(AuthGuard)
  @Roles('admin')
  admin() { return { allowed: true }; }
}

@Module({ controllers: [RoleTestController], providers: [Database, AuthService, AuthGuard] })
class RoleTestModule {}

describe('local auth with file-backed SQLite', () => {
  let app: INestApplication;
  let dir: string;
  let auth: AuthService;
  let db: Database;
  const password = 'test-password-for-local-use';

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-auth-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: password });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
    db = app.get(Database);
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('hashes with a random salt and verifies correct passwords only', () => {
    const hash = hashPassword(password);
    expect(hash).not.toContain(password);
    expect(hashPassword(password)).not.toEqual(hash);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword(password, 'bad:hash')).toBe(false);
    expect(auth.login('ADMIN@example.test', password).user.role).toBe('admin');
    expect(() => auth.login('admin@example.test', 'bad')).toThrow();
  });

  it('bootstraps once and preserves the stored hash when env credentials change', () => {
    const stored = db.db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    expect(stored.password_hash).not.toContain(password);
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-different-password';
    const restarted = new AuthService(db);
    expect(restarted.login('admin@example.test', password).user.name).toBe('Test Admin');
    expect(() => restarted.login('admin@example.test', 'a-different-password')).toThrow();
  });

  it('serves health and rejects missing, malformed, wrong, expired and forged credentials', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', 'Basic xxx').expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 42, password }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@example.test', password: 'wrong' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'missing@example.test', password }).expect(401);
    const expired = jwt.sign({ sub: 'any' }, process.env.AUTH_SECRET!, { expiresIn: -1 });
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    const forged = jwt.sign({ sub: 'any' }, 'another-signing-key');
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('rejects malformed, missing, blank, wrong-type and oversized login input without establishing a session', async () => {
    const server = app.getHttpServer();
    const before = db.db.prepare('SELECT * FROM users ORDER BY id').all();
    const valid = { email: 'admin@example.test', password };
    const cases: { label: string; body: unknown; status: number }[] = [
      { label: 'null body', body: null, status: 400 },
      { label: 'array body', body: [], status: 400 },
      { label: 'string body', body: 'login', status: 400 },
      { label: 'number body', body: 42, status: 400 },
      { label: 'empty object', body: {}, status: 400 },
      { label: 'missing email', body: { password }, status: 400 },
      { label: 'missing password', body: { email: valid.email }, status: 400 },
      { label: 'empty email', body: { ...valid, email: '' }, status: 400 },
      { label: 'blank email', body: { ...valid, email: ' \t ' }, status: 400 },
      { label: 'empty password', body: { ...valid, password: '' }, status: 400 },
      // Passwords are not trimmed; whitespace is an incorrect credential, not a malformed field.
      { label: 'blank password', body: { ...valid, password: '   ' }, status: 401 },
      ...(['email', 'password'] as const).flatMap(field => [null, 0, false, [], {}].map(value => ({
        label: `${field} has type ${JSON.stringify(value)}`, body: { ...valid, [field]: value }, status: 400
      }))),
      { label: 'one-character email', body: { ...valid, email: 'x' }, status: 401 },
      { label: 'maximum email', body: { ...valid, email: 'x'.repeat(254) }, status: 401 },
      { label: 'email above maximum', body: { ...valid, email: 'x'.repeat(255) }, status: 400 },
      { label: 'one-character password', body: { ...valid, password: 'x' }, status: 401 },
      { label: 'maximum password', body: { ...valid, password: 'x'.repeat(1024) }, status: 401 },
      { label: 'password above maximum', body: { ...valid, password: 'x'.repeat(1025) }, status: 400 },
      { label: 'body exceeds JSON limit', body: { ...valid, password: 'x'.repeat(110_000) }, status: 413 }
    ];
    for (const { label, body, status } of cases) {
      const agent = request.agent(server);
      const response = await agent.post('/api/v1/auth/login').set('Content-Type', 'application/json').send(JSON.stringify(body));
      expect([label, response.status]).toEqual([label, status]);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      await agent.get('/api/v1/auth/me').expect(401);
      expect(db.db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before);
    }
    const emptyAgent = request.agent(server);
    const emptyBody = await emptyAgent.post('/api/v1/auth/login');
    expect(emptyBody.status).toBe(400);
    expect(emptyBody.headers['set-cookie']).toBeUndefined();
    expect(emptyBody.body.token).toBeUndefined();
    await emptyAgent.get('/api/v1/auth/me').expect(401);
    expect(db.db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before);

    const agent = request.agent(server);
    const malformed = await agent.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['set-cookie']).toBeUndefined();
    expect(malformed.body.token).toBeUndefined();
    await agent.get('/api/v1/auth/me').expect(401);
    expect(db.db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before);

    // Limits are inclusive: genuine credentials at both maximum lengths can authenticate.
    const maxEmail = 'a'.repeat(241) + '@example.test';
    const maxPassword = 'p'.repeat(1024);
    db.db.prepare('UPDATE users SET email=?, password_hash=?').run(maxEmail, hashPassword(maxPassword));
    const boundaryAgent = request.agent(server);
    const boundary = await boundaryAgent.post('/api/v1/auth/login').send({ email: maxEmail, password: maxPassword }).expect(201);
    expect(boundary.headers['set-cookie'][0]).toContain('eqip_session=');
    expect(boundary.body.token).toEqual(expect.any(String));
    await boundaryAgent.get('/api/v1/auth/me').expect(200).expect(({ body }) => expect(body.email).toBe(maxEmail));
  });

  it('logs in, resolves identity via cookie or bearer and rejects disabled accounts', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@example.test', password }).expect(201);
    expect(result.body.user).toMatchObject({ email: 'admin@example.test', name: 'Test Admin', role: 'admin' });
    expect(result.body.user.password_hash).toBeUndefined();
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    const token = result.body.token;
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200).expect(({ body }) => expect(body.email).toBe('admin@example.test'));
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', result.headers['set-cookie']).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(201).expect(({ headers }) => expect(headers['set-cookie'][0]).toContain('eqip_session=;'));
    db.db.prepare("UPDATE users SET status='disabled'").run();
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@example.test', password }).expect(401);
  });

  it('fails closed for weak configuration and production mode', () => {
    process.env.AUTH_SECRET = 'change-me';
    expect(() => new AuthService(db)).toThrow('AUTH_SECRET');
    process.env.AUTH_SECRET = 'test-signing-key-0123456789-abcdef-xyz';
    process.env.NODE_ENV = 'production';
    expect(() => new AuthService(db)).toThrow('production');
    process.env.NODE_ENV = 'test';
    db.db.exec('DELETE FROM users');
    process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
    expect(() => new AuthService(db)).toThrow('BOOTSTRAP_ADMIN');
  });

  it('persists identities after closing and reopening the database file', async () => {
    const before = auth.login('admin@example.test', password).user;
    await app.close();
    const reopened = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = reopened.createNestApplication();
    await app.init();
    expect(app.get(AuthService).login('admin@example.test', password).user).toEqual(before);
  });

  it('enforces role requirements against the current database role', async () => {
    const roleModule = await Test.createTestingModule({ imports: [RoleTestModule] }).compile();
    const roleApp = roleModule.createNestApplication();
    await roleApp.init();
    try {
      const token = auth.login('admin@example.test', password).token;
      await request(roleApp.getHttpServer()).get('/test-role').expect(401);
      await request(roleApp.getHttpServer()).get('/test-role').set('Authorization', `Bearer ${token}`).expect(200);
      db.db.prepare("UPDATE users SET role='viewer'").run();
      await request(roleApp.getHttpServer()).get('/test-role').set('Authorization', `Bearer ${token}`).expect(403);
    } finally { await roleApp.close(); }
  });
});
