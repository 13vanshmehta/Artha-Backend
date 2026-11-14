import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  statusCode: number;
  errorCode: string;
  message: string | string[];
  details?: Record<string, unknown>;
}

function buildHost(): {
  host: ArgumentsHost;
  captured: () => CapturedResponse;
} {
  let body: CapturedResponse | undefined;
  let statusCode = 0;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: CapturedResponse) {
      body = payload;
      return this;
    },
  };

  const request = { method: 'POST', url: '/api/v1/auth/login' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    captured: () => {
      if (!body) throw new Error('filter did not write a response');
      return { ...body, statusCode };
    },
  };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  // Prisma messages embed the absolute path of the calling source file plus a
  // snippet of the surrounding code, so they must never reach the client.
  const PRISMA_AUTH_FAILURE = [
    '',
    'Invalid `this.prisma.user.findUnique()` invocation in',
    '/Users/someone/Developer/backend/src/auth/auth.service.ts:544:41',
    '',
    'User was denied access on the database `(not available)`',
  ].join('\n');

  it('maps a Prisma initialization failure to 503 without leaking internals', () => {
    const { host, captured } = buildHost();

    filter.catch(
      new Prisma.PrismaClientInitializationError(PRISMA_AUTH_FAILURE, '6.19.3'),
      host,
    );

    const res = captured();
    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(res.errorCode).toBe('DATABASE_UNAVAILABLE');
    expect(res.message).not.toContain('prisma');
    expect(res.message).not.toContain('auth.service.ts');
    expect(res.details).toBeUndefined();
  });

  it('maps a unique-constraint violation to 409', () => {
    const { host, captured } = buildHost();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
      host,
    );

    const res = captured();
    expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    expect(res.errorCode).toBe('CONFLICT');
  });

  it('maps a missing record to 404', () => {
    const { host, captured } = buildHost();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
      }),
      host,
    );

    expect(captured().statusCode).toBe(HttpStatus.NOT_FOUND);
  });

  it('still honours explicit HttpExceptions', () => {
    const { host, captured } = buildHost();

    filter.catch(new NotFoundException('No such session'), host);

    const res = captured();
    expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(res.errorCode).toBe('NOT_FOUND');
    expect(res.message).toBe('No such session');
  });
});
