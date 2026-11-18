/** Wire the local access service and liveness endpoint. */
import { Controller, Get, Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Database } from './database';

@Controller('api')
export class HealthController {
  /** Report process liveness without requiring credentials. */
  @Get('health') health() { return { status: 'ok' }; }
}

@Module({ controllers: [HealthController, AuthController], providers: [Database, AuthService, AuthGuard] })
export class AppModule {}
