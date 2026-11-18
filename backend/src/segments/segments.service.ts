/** Manage segment inventory in the configured SQLite file. */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from '../database';

export interface Segment { id: string; name: string; owner: string }

/** Validate and normalize the editable fields. */
function fields(body: unknown): { name: string; owner: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Name and owner are required');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'name' && key !== 'owner') ||
      typeof record.name !== 'string' || typeof record.owner !== 'string' ||
      !record.name.trim() || !record.owner.trim() || record.name.trim().length > 120 || record.owner.trim().length > 120) {
    throw new BadRequestException('Name and owner are required and must be at most 120 characters');
  }
  return { name: record.name.trim(), owner: record.owner.trim() };
}

@Injectable()
export class SegmentsService {
  constructor(private readonly database: Database) {}

  /** Return the inventory in name order. */
  list(): Segment[] {
    return this.database.db.prepare('SELECT id, name, owner FROM segments ORDER BY name COLLATE NOCASE, id').all() as unknown as Segment[];
  }

  /** Create a uniquely named segment. */
  create(body: unknown): Segment {
    const values = fields(body);
    const segment = { id: randomUUID(), ...values };
    try {
      this.database.db.prepare('INSERT INTO segments (id, name, owner) VALUES (?, ?, ?)').run(segment.id, segment.name, segment.owner);
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed: segments.name')) throw new ConflictException('Segment name already exists');
      throw error;
    }
    return segment;
  }

  /** Replace the editable fields of an existing segment. */
  update(id: string, body: unknown): Segment {
    const values = fields(body);
    if (!this.database.db.prepare('SELECT id FROM segments WHERE id = ?').get(id)) throw new NotFoundException('Segment not found');
    try {
      this.database.db.prepare('UPDATE segments SET name = ?, owner = ? WHERE id = ?').run(values.name, values.owner, id);
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed: segments.name')) throw new ConflictException('Segment name already exists');
      throw error;
    }
    return { id, ...values };
  }
}
