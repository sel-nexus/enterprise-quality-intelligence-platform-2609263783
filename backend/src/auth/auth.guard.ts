/** Enforce authentication and optional role requirements on protected routes. */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService, User } from './auth.service';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
export interface AuthenticatedRequest extends Request { user: User }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  /** Reject missing, invalid, inactive or insufficiently privileged identities. */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('eqip_session='))?.slice('eqip_session='.length);
    const token = header ? /^Bearer ([^\s]+)$/.exec(header)?.[1] : cookie;
    if (!token) throw new UnauthorizedException('Authentication required');
    request.user = this.auth.authenticate(token);
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(request.user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
