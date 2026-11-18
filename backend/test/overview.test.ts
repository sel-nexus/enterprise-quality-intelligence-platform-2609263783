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
import { OverviewService, csvCell } from '../src/overview/overview.service';
import { SegmentsService } from '../src/segments/segments.service';
import { ApplicationsService } from '../src/applications/applications.service';
import { UsersService } from '../src/users/users.service';

describe('executive overview with file SQLite', () => {
  let app: INestApplication, dir: string, token: string, actor: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eqip-overview-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(dir, 'db.sqlite'), AUTH_SECRET: 'test-signing-key-0123456789-abcdef-xyz', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_NAME: 'Test Admin', BOOTSTRAP_ADMIN_PASSWORD: 'test-password-for-local-use' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    const admin = app.get(AuthService).login('admin@example.test', 'test-password-for-local-use');
    token = admin.token; actor = admin.user.id;
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('counts persisted inventory, excludes disabled users and never invents scores', async () => {
    const service = app.get(OverviewService);
    expect(service.getOverview()).toEqual({ counts: { segments: 0, applications: 0, activeUsers: 1 }, qualityScore: null });
    const segment = app.get(SegmentsService).create({ name: '=unsafe segment', owner: 'Private owner' });
    app.get(ApplicationsService).create({ name: 'App', owner: 'Private owner', segmentId: segment.id, lifecycle: 'Production', criticality: 'High' });
    const users = app.get(UsersService);
    users.create({ name: 'Private', email: 'private@example.test', password: 'local-password-123', role: 'viewer', status: 'active', segmentId: null }, actor);
    users.create({ name: 'Disabled', email: 'disabled@example.test', password: 'local-password-123', role: 'viewer', status: 'disabled', segmentId: null }, actor);
    expect(service.getOverview()).toEqual({ counts: { segments: 1, applications: 1, activeUsers: 2 }, qualityScore: null });
    const csv = service.getCsv();
    expect(csv).toContain('"Sensitivity","Internal"\r\n');
    expect(csv).toContain('"Active users","2"');
    expect(csv).toContain('"Quality score","Unavailable"');
    expect(csv).not.toMatch(/private|unsafe|example\.test/i);
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    expect(app.get(OverviewService).getOverview().counts).toEqual({ segments: 1, applications: 1, activeUsers: 2 });
  });

  it('escapes CSV delimiters, quotes, controls and formula prefixes', () => {
    expect(csvCell('hello,"world"')).toBe('"hello,""world"""');
    for (const input of ['=1+1', '+cmd', '-1', '@sum', '  =1', '\tvalue', '\r=1']) expect(csvCell(input)).toBe(`"'${input}"`);
    expect(csvCell(42)).toBe('"42"');
  });

  it('enforces authentication and live administrator role on both endpoints', async () => {
    const server = app.getHttpServer();
    const users = app.get(UsersService);
    const viewer = users.create({ name: 'Viewer', email: 'viewer@example.test', password: 'local-password-123', role: 'viewer', status: 'active', segmentId: null }, actor);
    const viewerToken = app.get(AuthService).login('viewer@example.test', 'local-password-123').token;
    for (const path of ['/api/v1/overview', '/api/v1/overview/report.csv']) {
      await request(server).get(path).expect(401);
      await request(server).get(path).set('Authorization', 'Bearer invalid').expect(401);
      await request(server).get(path).set('Authorization', `Bearer ${viewerToken}`).expect(403);
    }
    const overview = await request(server).get('/api/v1/overview').set('Authorization', `Bearer ${token}`).expect(200);
    expect(overview.headers['cache-control']).toBe('no-store');
    expect(overview.body).toEqual({ counts: { segments: 0, applications: 0, activeUsers: 2 }, qualityScore: null });
    const report = await request(server).get('/api/v1/overview/report.csv').set('Authorization', `Bearer ${token}`).expect(200);
    expect(report.headers['content-type']).toMatch(/^text\/csv/);
    expect(report.headers['content-disposition']).toContain('attachment');
    expect(report.headers['cache-control']).toBe('no-store');
    expect(report.text).toContain('"Sensitivity","Internal"');
    expect(report.text).not.toContain('viewer@example.test');
    app.get(Database).db.prepare('UPDATE users SET status = ? WHERE id = ?').run('disabled', viewer.id);
    await request(server).get('/api/v1/overview/report.csv').set('Authorization', `Bearer ${viewerToken}`).expect(401);
    app.get(Database).db.prepare('UPDATE users SET role = ? WHERE id = ?').run('viewer', actor);
    await request(server).get('/api/v1/overview').set('Authorization', `Bearer ${token}`).expect(403);
    await request(server).get('/api/v1/overview/report.csv').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('does not present a database failure as zero counts or a successful report', async () => {
    app.get(Database).db.exec('DROP TABLE applications');
    expect(() => app.get(OverviewService).getOverview()).toThrow();
    await request(app.getHttpServer()).get('/api/v1/overview').set('Authorization', `Bearer ${token}`).expect(500);
    await request(app.getHttpServer()).get('/api/v1/overview/report.csv').set('Authorization', `Bearer ${token}`).expect(500);
  });
});
