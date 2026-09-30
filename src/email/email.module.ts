import { Global, Module } from '@nestjs/common';
import { EmailPreviewController } from './email-preview.controller';
import { EmailRendererService } from './email-renderer.service';

@Global()
@Module({
  controllers: [EmailPreviewController],
  providers: [EmailRendererService],
  exports: [EmailRendererService],
})
export class EmailModule {}
