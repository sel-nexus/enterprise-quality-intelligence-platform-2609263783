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

@Controller('api')
export class HealthController {
  /** Report process liveness without requiring credentials. */
  @Get('health') health() { return { status: 'ok' }; }
}

@Module({ controllers: [HealthController, AuthController, SegmentsController, ApplicationsController], providers: [Database, AuthService, AuthGuard, SegmentsService, ApplicationsService] })
export class AppModule {}
