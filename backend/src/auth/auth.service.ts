/** Authenticate local users and verify short-lived signed credentials. */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { Database } from '../database';

export interface User { id: string; name: string; email: string; role: string; status: string }
interface StoredUser extends User { password_hash: string }

/** Hash a password with an independently generated salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/** Check a password without comparing derived keys as strings. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key, extra] = stored.split(':');
  if (extra !== undefined || !/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(key || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}

@Injectable()
export class AuthService {
  private readonly secret: string;

  /** Validate security configuration and bootstrap only an empty database. */
  constructor(private readonly database: Database) {
    if (process.env.NODE_ENV === 'production') throw new Error('Local authentication is not supported in production');
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32 || /replace|change.?me|dev.secret/i.test(secret)) throw new Error('AUTH_SECRET must be a unique random secret of at least 32 characters');
    this.secret = secret;
    const count = this.database.db.prepare('SELECT count(*) AS count FROM users').get() as { count: number };
    if (count.count === 0) {
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !password || password.length < 12 || /replace|change.?me/i.test(password)) {
        throw new Error('Explicit valid BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD (12+ characters) are required for an empty database');
      }
      this.database.db.prepare('INSERT INTO users (id,name,email,password_hash,role,status) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), name, email, hashPassword(password), 'admin', 'active');
    }
  }

  /** Authenticate an active identity and issue a one-hour credential. */
  login(email: string, password: string): { token: string; user: User } {
    const row = this.database.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as unknown as StoredUser | undefined;
    if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) throw new UnauthorizedException('Invalid email or password');
    const user = this.publicUser(row);
    return { token: jwt.sign({ sub: user.id }, this.secret, { algorithm: 'HS256', expiresIn: '1h' }), user };
  }

  /** Resolve a signed credential to the current active database identity. */
  authenticate(token: string): User {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('Invalid subject');
      const row = this.database.db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as unknown as StoredUser | undefined;
      if (!row || row.status !== 'active') throw new Error('Inactive identity');
      return this.publicUser(row);
    } catch { throw new UnauthorizedException('Invalid or expired credentials'); }
  }

  /** Exclude the password hash from identity responses. */
  private publicUser(row: StoredUser): User {
    return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
  }
}
