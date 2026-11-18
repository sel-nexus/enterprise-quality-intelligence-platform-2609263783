/** Maintain application inventory in SQLite. */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from '../database';

export interface Application { id: string; name: string; segmentId: string; owner: string; lifecycle: string; criticality: string }
type Fields = Omit<Application, 'id'>;

/** Validate and normalize the complete editable record. */
function fields(body: unknown): Fields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid application fields');
  const record = body as Record<string, unknown>;
  const keys = ['name', 'segmentId', 'owner', 'lifecycle', 'criticality'];
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => typeof record[key] !== 'string' || !(record[key] as string).trim() || (record[key] as string).trim().length > 120)) {
    throw new BadRequestException('All application fields are required and must be at most 120 characters');
  }
  const values = Object.fromEntries(keys.map(key => [key, (record[key] as string).trim()])) as unknown as Fields;
  if (!['Production', 'UAT', 'Pre-Prod', 'Retired'].includes(values.lifecycle) || !['High', 'Medium', 'Low'].includes(values.criticality)) throw new BadRequestException('Invalid lifecycle or criticality');
  return values;
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly database: Database) {}

  /** Return applications in name order, optionally filtered by name or owner. */
  list(search = ''): Application[] {
    if (typeof search !== 'string' || search.length > 120) throw new BadRequestException('Invalid search');
    const query = search.trim().toLowerCase();
    const rows = this.database.db.prepare('SELECT id, name, segment_id AS segmentId, owner, lifecycle, criticality FROM applications ORDER BY name COLLATE NOCASE, id').all() as unknown as Application[];
    return rows.filter(row => row.name.toLowerCase().includes(query) || row.owner.toLowerCase().includes(query));
  }

  /** Create an application with a unique name and existing segment. */
  create(body: unknown): Application {
    const values = fields(body);
    this.checkSegment(values.segmentId);
    const item = { id: randomUUID(), ...values };
    try {
      this.database.db.prepare('INSERT INTO applications (id, name, segment_id, owner, lifecycle, criticality) VALUES (?, ?, ?, ?, ?, ?)').run(item.id, item.name, item.segmentId, item.owner, item.lifecycle, item.criticality);
    } catch (error) { this.handleWriteError(error); }
    return item;
  }

  /** Replace editable fields on an existing application. */
  update(id: string, body: unknown): Application {
    const values = fields(body);
    if (!this.database.db.prepare('SELECT id FROM applications WHERE id = ?').get(id)) throw new NotFoundException('Application not found');
    this.checkSegment(values.segmentId);
    try {
      this.database.db.prepare('UPDATE applications SET name = ?, segment_id = ?, owner = ?, lifecycle = ?, criticality = ? WHERE id = ?').run(values.name, values.segmentId, values.owner, values.lifecycle, values.criticality, id);
    } catch (error) { this.handleWriteError(error); }
    return { id, ...values };
  }

  /** Reject references to missing segments. */
  private checkSegment(id: string): void {
    if (!this.database.db.prepare('SELECT id FROM segments WHERE id = ?').get(id)) throw new BadRequestException('Unknown segment');
  }

  /** Translate SQLite integrity failures without hiding unrelated errors. */
  private handleWriteError(error: unknown): never {
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
    if (message.includes('UNIQUE constraint failed: applications.name')) throw new ConflictException('Application name already exists');
    if (message.includes('FOREIGN KEY constraint failed')) throw new BadRequestException('Unknown segment');
    throw error;
  }
}
