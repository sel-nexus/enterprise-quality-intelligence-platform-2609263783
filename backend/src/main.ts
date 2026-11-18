/** Start the local-only API. */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Start the server after validating configuration. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  if (process.env.CORS_ORIGIN) app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port');
  await app.listen(port, process.env.HOST || '127.0.0.1');
}
bootstrap().catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
