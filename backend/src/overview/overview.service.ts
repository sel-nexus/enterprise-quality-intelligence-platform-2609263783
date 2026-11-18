/** Derive a minimal, non-identifying inventory report from SQLite. */
import { Injectable } from '@nestjs/common';
import { Database } from '../database';

/** Quote CSV cells and neutralize spreadsheet formula prefixes, including whitespace. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class OverviewService {
  constructor(private readonly database: Database) {}

  /** Read all counts in one SQLite statement and mark unimplemented scores unavailable. */
  getOverview() {
    const counts = this.database.db.prepare(`SELECT
      (SELECT count(*) FROM segments) AS segments,
      (SELECT count(*) FROM applications) AS applications,
      (SELECT count(*) FROM users WHERE status = 'active') AS activeUsers`).get() as { segments: number; applications: number; activeUsers: number };
    return { counts, qualityScore: null };
  }

  /** Export only fixed aggregate fields with an explicit internal label. */
  getCsv(): string {
    const { counts } = this.getOverview();
    const rows: (string | number)[][] = [
      ['Sensitivity', 'Internal'],
      ['Metric', 'Value'],
      ['Segments', counts.segments],
      ['Applications', counts.applications],
      ['Active users', counts.activeUsers],
      ['Quality score', 'Unavailable'],
    ];
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}
