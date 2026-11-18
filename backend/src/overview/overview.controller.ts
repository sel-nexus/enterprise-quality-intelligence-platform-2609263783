/** Protect executive aggregate and report data with the local administrator role. */
import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { OverviewService } from './overview.service';

@Controller('api/v1/overview')
@UseGuards(AuthGuard)
@Roles('admin')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** Return current aggregate counts. */
  @Get()
  @Header('Cache-Control', 'no-store')
  getOverview() { return this.overview.getOverview(); }

  /** Download a basic, internal-only CSV of aggregate metrics. */
  @Get('report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="eqip-overview.csv"')
  @Header('Cache-Control', 'no-store')
  report() { return this.overview.getCsv(); }
}
