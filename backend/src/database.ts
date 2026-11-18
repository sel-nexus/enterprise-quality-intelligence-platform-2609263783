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
      );`);
  }

  /** Close the database on application shutdown. */
  onModuleDestroy(): void { this.db.close(); }
}
