import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Other controllers
import { AuthController } from './auth/auth.controller';
import { AttachmentsController } from './attachments/attachments.controller';
import { DemergeController } from './demerge/demerge.controller';
import { DownloadController } from './download/download.controller';
import { PdfController } from './pdf/pdf.controller';

// Other services
import { AuthService } from './auth/auth.service';
import { GmailService } from './gmail/gmail.service';
import { PdfService } from './pdf/pdf.service';
import { HtmlService } from './html/html.service';
import { PuppeteerService } from './puppeteer/puppeteer.service';
import { AttachmentsService } from './attachments/attachments.service';
import { DownloadService } from './download/download.service';
import { DemergeService } from './demerge/demerge.service';

// Custom modules
import { EmailsModule } from './emails/emails.module';
import { SupabaseService } from './supabase/supabase.service';
import { AutoProcessService } from './auto/auto.service';
import { AutoProcessController } from './auto/auto.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EmailsModule, // ⬅️ 让 EmailsModule 负责 EmailsController 和 EmailsService
  ],
  controllers: [
    AuthController,
    AttachmentsController,
    DemergeController,
    DownloadController,
    PdfController,
    AutoProcessController,
  ],
  providers: [
    AuthService,
    GmailService,
    PdfService,
    HtmlService,
    PuppeteerService,
    AttachmentsService,
    DownloadService,
    DemergeService,
    SupabaseService,
    AutoProcessService,
  ],
})
export class AppModule {}
