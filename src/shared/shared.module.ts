// src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { GmailService } from '../gmail/gmail.service';
import { HtmlService } from '../html/html.service';
import { PdfService } from '../pdf/pdf.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthService } from '../auth/auth.service';

@Module({
  providers: [
    GmailService,
    HtmlService,
    PdfService,
    PuppeteerService,
    SupabaseService,
    AttachmentsService,
    AuthService,
  ],
  exports: [
    GmailService,
    HtmlService,
    PdfService,
    PuppeteerService,
    SupabaseService,
    AttachmentsService,
    AuthService,
  ],
})
export class SharedModule {}
