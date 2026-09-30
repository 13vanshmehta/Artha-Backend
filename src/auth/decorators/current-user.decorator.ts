import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedPrincipal | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedPrincipal | string => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedPrincipal }>();
    const user = request.user;
    return data ? user[data] : user;
  },
);
