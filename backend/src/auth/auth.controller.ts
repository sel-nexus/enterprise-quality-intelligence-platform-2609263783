/** Expose local sign-in, identity lookup and sign-out. */
import { BadRequestException, Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Validate input and establish a local browser session. */
  @Post('login')
  login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Email and password are required');
    const { email, password } = body as Record<string, unknown>;
    if (typeof email !== 'string' || !email.trim() || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) throw new BadRequestException('Email and password are required');
    const result = this.auth.login(email, password);
    response.cookie('eqip_session', result.token, { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 3600000, path: '/' });
    return result;
  }

  /** Return the authenticated identity from the database. */
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) { return request.user; }

  /** Remove the browser credential; existing copied tokens expire naturally. */
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('eqip_session', { httpOnly: true, sameSite: 'strict', path: '/' });
    return { message: 'Signed out' };
  }
}
