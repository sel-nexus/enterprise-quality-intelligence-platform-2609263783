/** Restrict local user administration to active administrators. */
import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthGuard, Roles } from '../auth/auth.guard';
import { UsersService } from './users.service';

@Controller('api/v1/users')
@UseGuards(AuthGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** List the user inventory. */
  @Get()
  list() { return { items: this.users.list() }; }

  /** Create an identity with an auditable initial access assignment. */
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.users.create(body, request.user.id); }

  /** Replace an identity's editable fields. */
  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.users.update(id, body, request.user.id); }
}
