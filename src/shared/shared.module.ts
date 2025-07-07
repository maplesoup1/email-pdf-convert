// src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GmailService } from '../gmail/gmail.service';
import { HtmlService } from '../html/html.service';
import { PdfService } from '../pdf/pdf.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthService } from '../auth/auth.service';
import { AutoProcessService } from '../auto/auto.service';
import { EmailsService } from '../emails/emails.service'; // 添加这行

@Module({
  imports: [
    ScheduleModule.forRoot(), // 添加这行，因为 AutoProcessService 使用 @Cron
  ],
  providers: [
    GmailService,
    HtmlService,
    PdfService,
    PuppeteerService,
    SupabaseService,
    AttachmentsService,
    AuthService,
    EmailsService,      // 添加这行
    AutoProcessService,
  ],
  exports: [
    GmailService,
    HtmlService,
    PdfService,
    PuppeteerService,
    SupabaseService,
    AttachmentsService,
    AuthService,
    EmailsService,      // 添加这行
    AutoProcessService,
  ],
})
export class SharedModule {}