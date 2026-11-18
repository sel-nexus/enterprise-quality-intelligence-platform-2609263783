/** Expose authenticated, fail-closed application inventory endpoints. */
import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { ApplicationsService } from './applications.service';

@Controller('api/v1/applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Limit reads to administrators until segment claims exist. */
  @Get()
  @Roles('admin')
  list(@Query('search') search?: string) { return { items: this.applications.list(search) }; }

  /** Create an application as an administrator. */
  @Post()
  @Roles('admin')
  create(@Body() body: unknown) { return this.applications.create(body); }

  /** Update an application as an administrator. */
  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: unknown) { return this.applications.update(id, body); }
}
