/** Wire the local access service and liveness endpoint. */
import { Controller, Get, Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Database } from './database';
import { SegmentsController } from './segments/segments.controller';
import { SegmentsService } from './segments/segments.service';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { OverviewController } from './overview/overview.controller';
import { OverviewService } from './overview/overview.service';

@Controller('api')
export class HealthController {
  /** Report process liveness without requiring credentials. */
  @Get('health') health() { return { status: 'ok' }; }
}

@Module({ controllers: [HealthController, AuthController, SegmentsController, ApplicationsController, UsersController, OverviewController], providers: [Database, AuthService, AuthGuard, SegmentsService, ApplicationsService, UsersService, OverviewService] })
export class AppModule {}
