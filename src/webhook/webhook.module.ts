import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { EmailsModule } from '../emails/emails.module';

@Module({
    imports: [
        forwardRef(() => EmailsModule)  // 避免循环依赖
    ],
    controllers: [WebhookController],
    providers: [WebhookService],
    exports: [WebhookService]
})
export class WebhookModule {}