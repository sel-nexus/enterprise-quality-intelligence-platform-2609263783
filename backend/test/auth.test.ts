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
