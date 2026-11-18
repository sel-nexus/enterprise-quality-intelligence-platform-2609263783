/** Persist local identities in a file-backed SQLite database. */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly db: DatabaseSync;

  /** Open the configured file and initialize the identity table. */
  constructor() {
    const path = process.env.DATABASE_PATH;
    if (!path || path === ':memory:') throw new Error('DATABASE_PATH must name a SQLite file');
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, owner TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        segment_id TEXT NOT NULL REFERENCES segments(id), owner TEXT NOT NULL,
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('Production', 'UAT', 'Pre-Prod', 'Retired')),
        criticality TEXT NOT NULL CHECK (criticality IN ('High', 'Medium', 'Low'))
      );`);
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[];
    if (!columns.some(column => column.name === 'segment_id')) {
      this.db.exec('ALTER TABLE users ADD COLUMN segment_id TEXT REFERENCES segments(id)');
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS user_access_audit (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
      field TEXT NOT NULL CHECK (field IN ('role', 'status', 'segmentId')),
      old_value TEXT, new_value TEXT, occurred_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS user_access_audit_no_replace BEFORE INSERT ON user_access_audit
      WHEN EXISTS (SELECT 1 FROM user_access_audit WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS user_access_audit_no_update BEFORE UPDATE ON user_access_audit
      BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS user_access_audit_no_delete BEFORE DELETE ON user_access_audit
      BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;`);
  }

  /** Close the database on application shutdown. */
  onModuleDestroy(): void { this.db.close(); }
}
