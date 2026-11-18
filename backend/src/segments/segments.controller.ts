/** Expose authenticated inventory reads and administrator writes. */
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { SegmentsService } from './segments.service';

@Controller('api/v1/segments')
@UseGuards(AuthGuard)
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  /** List segments for any active authenticated user. */
  @Get()
  list() { return { items: this.segments.list() }; }

  /** Create a segment as an administrator. */
  @Post()
  @Roles('admin')
  create(@Body() body: unknown) { return this.segments.create(body); }

  /** Update a segment as an administrator. */
  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: unknown) { return this.segments.update(id, body); }
}
