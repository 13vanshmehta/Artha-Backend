import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('System & Observability')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Application root discovery ping' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({
    summary: 'General health check probe for load balancers and reverse proxies',
  })
  @ApiResponse({ status: 200, description: 'Service is responding' })
  getHealth(): { status: string; uptimeSeconds: number; timestamp: string } {
    return this.appService.getHealth();
  }

  @Get('health/live')
  @ApiOperation({
    summary: 'Process liveness probe for container orchestrators (Kubernetes/ECS)',
  })
  @ApiResponse({ status: 200, description: 'Application process is alive' })
  getLiveness() {
    return this.appService.getLiveness();
  }

  @Get('health/ready')
  @ApiOperation({
    summary:
      'Readiness probe validating database and cache connectivity before serving traffic',
  })
  @ApiResponse({
    status: 200,
    description: 'Service dependencies are ready to serve requests',
  })
  @ApiResponse({ status: 503, description: 'Dependencies unavailable' })
  async getReadiness() {
    return this.appService.getReadiness();
  }
}
