/** Manage local identities and record access changes atomically. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/auth.service';
import { Database } from '../database';

const roles = ['admin', 'executive', 'segment_leader', 'qe_leader', 'qe_manager', 'engineer', 'release_manager', 'auditor', 'vendor', 'viewer'];
interface Account { id: string; name: string; email: string; role: string; status: string; segmentId: string | null }
interface Fields { name: string; email: string; role: string; status: string; segmentId: string | null; password?: string }

/** Validate the complete editable representation before touching the database. */
function fields(body: unknown, creating: boolean): Fields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid user');
  const r = body as Record<string, unknown>;
  if (Object.keys(r).some(k => !['name', 'email', 'role', 'status', 'segmentId', 'password'].includes(k)) ||
      typeof r.name !== 'string' || !r.name.trim() || r.name.trim().length > 120 ||
      typeof r.email !== 'string' || r.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()) ||
      typeof r.role !== 'string' || !roles.includes(r.role) ||
      typeof r.status !== 'string' || !['active', 'disabled'].includes(r.status) ||
      !(r.segmentId === null || (typeof r.segmentId === 'string' && r.segmentId.length > 0 && r.segmentId.length <= 128)) ||
      (creating && typeof r.password !== 'string') ||
      (r.password !== undefined && (typeof r.password !== 'string' || r.password.length < 12 || r.password.length > 1024))) {
    throw new BadRequestException('Invalid user fields; passwords must be 12–1024 characters');
  }
  return { name: r.name.trim(), email: r.email.trim().toLowerCase(), role: r.role, status: r.status, segmentId: r.segmentId as string | null, ...(r.password === undefined ? {} : { password: r.password as string }) };
}

@Injectable()
export class UsersService {
  constructor(private readonly database: Database) {}

  /** List identities without returning password hashes. */
  list(): Account[] {
    return this.database.db.prepare('SELECT id, name, email, role, status, segment_id AS segmentId FROM users ORDER BY name COLLATE NOCASE, id').all() as unknown as Account[];
  }

  /** Create a user and audit the initial access assignment. */
  create(body: unknown, actor: string): Account {
    const value = fields(body, true);
    const id = randomUUID();
    const hash = hashPassword(value.password!);
    return this.transaction(actor, () => {
      this.checkSegment(value.segmentId);
      this.database.db.prepare('INSERT INTO users (id,name,email,password_hash,role,status,segment_id) VALUES (?,?,?,?,?,?,?)')
        .run(id, value.name, value.email, hash, value.role, value.status, value.segmentId);
      this.audit(id, actor, 'role', null, value.role);
      this.audit(id, actor, 'status', null, value.status);
      if (value.segmentId !== null) this.audit(id, actor, 'segmentId', null, value.segmentId);
      return { id, name: value.name, email: value.email, role: value.role, status: value.status, segmentId: value.segmentId };
    });
  }

  /** Replace editable fields while preserving at least one active administrator. */
  update(id: string, body: unknown, actor: string): Account {
    const value = fields(body, false);
    const hash = value.password === undefined ? undefined : hashPassword(value.password);
    return this.transaction(actor, () => {
      const old = this.database.db.prepare('SELECT id,name,email,role,status,segment_id AS segmentId FROM users WHERE id = ?').get(id) as unknown as Account | undefined;
      if (!old) throw new NotFoundException('User not found');
      this.checkSegment(value.segmentId);
      if (old.role === 'admin' && old.status === 'active' && (value.role !== 'admin' || value.status !== 'active')) {
        const count = this.database.db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get() as { count: number };
        if (count.count <= 1) throw new ConflictException('Cannot disable or demote the last active administrator');
      }
      this.database.db.prepare('UPDATE users SET name=?,email=?,role=?,status=?,segment_id=? WHERE id=?').run(value.name, value.email, value.role, value.status, value.segmentId, id);
      if (hash !== undefined) this.database.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
      for (const field of ['role', 'status', 'segmentId'] as const) {
        if (old[field] !== value[field]) this.audit(id, actor, field, old[field], value[field]);
      }
      return { id, name: value.name, email: value.email, role: value.role, status: value.status, segmentId: value.segmentId };
    });
  }

  /** Serialize access mutations and recheck the actor after acquiring the write lock. */
  private transaction<T>(actor: string, work: () => T): T {
    const db = this.database.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND status='active'").get(actor)) throw new ForbiddenException('Administrator access required');
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed: users.email')) throw new ConflictException('Email already exists');
      throw error;
    }
  }

  /** Reject segment references that do not resolve. */
  private checkSegment(id: string | null): void {
    if (id !== null && !this.database.db.prepare('SELECT id FROM segments WHERE id=?').get(id)) throw new BadRequestException('Unknown segment');
  }

  /** Append a timestamped event; database triggers prevent later alteration. */
  private audit(id: string, actor: string, field: string, oldValue: string | null, newValue: string | null): void {
    this.database.db.prepare('INSERT INTO user_access_audit (id,user_id,actor_id,field,old_value,new_value,occurred_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), id, actor, field, oldValue, newValue, new Date().toISOString());
  }
}
