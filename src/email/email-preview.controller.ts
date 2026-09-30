import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ValidatedEnvConfig } from '../config/env.validation';
import { EmailRendererService } from './email-renderer.service';
import { EmailTemplateKey } from './email.types';

@ApiTags('Developer Tools & Email Previews')
@Controller('email/previews')
export class EmailPreviewController {
  constructor(
    private readonly renderer: EmailRendererService,
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
  ) {}

  private assertNonProduction(): void {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new NotFoundException({
        errorCode: 'PREVIEW_ENDPOINT_DISABLED',
        message: 'Email previews are disabled in production.',
      });
    }
  }

  @Get()
  @ApiOperation({
    summary:
      'List all available transactional email templates with live preview links (non-production only)',
  })
  listPreviews() {
    this.assertNonProduction();
    const keys = this.renderer.getAllTemplateKeys();
    return {
      templates: keys.map((key) => {
        const sample = this.renderer.getSamplePreviewData(key);
        const rendered = this.renderer.render(key, sample);
        return {
          key,
          subject: rendered.subject,
          preheader: rendered.preheader,
          previewHtmlUrl: `/api/v1/email/previews/${key}`,
          previewTextUrl: `/api/v1/email/previews/${key}?format=text`,
        };
      }),
    };
  }

  @Get(':templateKey')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary:
      'Render live visual preview of an email template in HTML or plaintext (non-production only)',
  })
  renderPreview(
    @Param('templateKey') templateKey: string,
    @Query('format') format?: string,
  ): string {
    this.assertNonProduction();

    const validKeys = this.renderer.getAllTemplateKeys();
    if (!validKeys.includes(templateKey as EmailTemplateKey)) {
      throw new NotFoundException({
        errorCode: 'TEMPLATE_NOT_FOUND',
        message: `Template "${templateKey}" not found. Available templates: ${validKeys.join(', ')}`,
      });
    }

    const key = templateKey as EmailTemplateKey;
    const sample = this.renderer.getSamplePreviewData(key);
    const rendered = this.renderer.render(key, sample);

    if (format === 'text') {
      return `<pre style="font-family: monospace; white-space: pre-wrap; padding: 20px; line-height: 1.5;">${rendered.text}</pre>`;
    }

    return rendered.html;
  }
}
