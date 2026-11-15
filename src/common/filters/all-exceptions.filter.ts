import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { summarizeConnectionFailure } from '../../prisma/prisma.service';

interface MappedError {
  status: HttpStatus;
  errorCode: string;
  message: string;
  /** Operator-facing explanation written to the server log, never to the client. */
  logHint?: string;
}

/**
 * Maps Prisma failures onto honest HTTP semantics. Without this every database
 * problem surfaces as a 500 whose body embeds the Prisma message — which in turn
 * embeds absolute source paths and a snippet of the service code.
 */
function mapPrismaError(exception: unknown): MappedError | undefined {
  if (
    exception instanceof Prisma.PrismaClientInitializationError ||
    exception instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      errorCode: 'DATABASE_UNAVAILABLE',
      message:
        'The service is temporarily unable to reach its database. Please try again shortly.',
      logHint: summarizeConnectionFailure(exception.message),
    };
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          errorCode: 'CONFLICT',
          message: 'A record with these details already exists.',
        };
      case 'P2025':
      case 'P2001':
        return {
          status: HttpStatus.NOT_FOUND,
          errorCode: 'NOT_FOUND',
          message: 'The requested record was not found.',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          errorCode: 'VALIDATION_ERROR',
          message: 'The request references a record that does not exist.',
        };
      case 'P1001':
      case 'P1002':
      case 'P1008':
      case 'P1010':
      case 'P2021':
      case 'P2022':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          errorCode: 'DATABASE_UNAVAILABLE',
          message:
            'The service is temporarily unable to reach its database. Please try again shortly.',
          logHint: summarizeConnectionFailure(exception.message),
        };
      default:
        return undefined;
    }
  }

  if (exception instanceof Prisma.PrismaClientValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      errorCode: 'VALIDATION_ERROR',
      message: 'The request could not be processed as submitted.',
    };
  }

  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message: string | string[] = 'An unexpected error occurred.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message =
          (body.message as string | string[]) ??
          (body.error as string) ??
          exception.message;
        errorCode =
          (body.errorCode as string) ?? this.defaultErrorCodeForStatus(status);
        if (body.details && typeof body.details === 'object') {
          details = body.details as Record<string, unknown>;
        }
      }
      if (errorCode === 'INTERNAL_SERVER_ERROR') {
        errorCode = this.defaultErrorCodeForStatus(status);
      }
    } else {
      const mapped = mapPrismaError(exception);
      const errStack =
        exception instanceof Error ? exception.stack : String(exception);

      if (process.env.NODE_ENV !== 'test') {
        this.logger.error(
          `Unhandled error on ${request.method} ${request.url}: ${mapped?.logHint ?? ''}${mapped?.logHint ? '\n' : ''}${errStack}`,
        );
      }

      if (mapped) {
        // Prisma messages embed absolute source paths and a snippet of the calling
        // service, so they are never echoed to the client — not even in development.
        status = mapped.status;
        errorCode = mapped.errorCode;
        message = mapped.message;
      } else if (
        process.env.NODE_ENV !== 'production' &&
        exception instanceof Error
      ) {
        message = exception.message;
        details = { stack: exception.stack };
      }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      errorCode,
      error: {
        code: errorCode,
        message,
        ...(details ? { details } : {}),
      },
      message,
      ...(details ? { details } : {}),
      meta: {
        timestamp: new Date().toISOString(),
        requestId: request?.correlationId,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private defaultErrorCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      default:
        return 'REQUEST_FAILED';
    }
  }
}
