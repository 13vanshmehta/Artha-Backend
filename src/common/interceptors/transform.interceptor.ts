import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T;
  meta: {
    timestamp: string;
    requestId?: string;
  };
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponseEnvelope<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseEnvelope<T> | T> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const path = request?.url || '';

    // Bypass wrapping for health probes and swagger documentation
    if (
      path === '/health' ||
      path.startsWith('/health/') ||
      path === '/' ||
      path.includes('/docs') ||
      path.includes('/swagger')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: any) => {
        // If data is already enveloped or null/undefined, handle cleanly
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          typeof data.success === 'boolean'
        ) {
          if (!data.meta) {
            data.meta = {
              timestamp: new Date().toISOString(),
              requestId: request?.correlationId,
            };
          }
          return data;
        }

        return {
          success: true,
          data: data ?? {},
          meta: {
            timestamp: new Date().toISOString(),
            requestId: request?.correlationId,
          },
        };
      }),
    );
  }
}
