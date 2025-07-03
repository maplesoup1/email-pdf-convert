import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Controllers
import { EmailsController } from './emails/emails.controller';
import { AuthController } from './auth/auth.controller';
import { AttachmentsController } from './attachments/attachments.controller';
import { DemergeController } from './demerge/demerge.controller';
import { DownloadController } from './download/download.controller';

// Services
import { EmailsService } from './emails/emails.service';
import { AuthService } from './auth/auth.service';
import { GmailService } from './gmail/gmail.service';
import { PdfService } from './pdf/pdf.service';
import { HtmlService } from './html/html.service';
import { PuppeteerService } from './puppeteer/puppeteer.service';
import { AttachmentsService } from './attachments/attachments.service';
import { DownloadService } from './download/download.service';
import { DemergeService } from './demerge/demerge.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [
    EmailsController,
    AuthController,
    AttachmentsController,
    DemergeController,
    DownloadController,
  ],
  providers: [
    EmailsService,
    AuthService,
    GmailService,
    PdfService,
    HtmlService,
    PuppeteerService,
    AttachmentsService,
    DownloadService,
    DemergeService,
  ],
})
export class AppModule {}