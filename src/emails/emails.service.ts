import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PdfRule } from '../emails/emails.entity';

export interface EmailProcessResult {
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  isHtml: boolean;
  payload: any;
  attachments: any[];
  pdfUrls: string[];
  pdfRule: PdfRule;
  merged: boolean;
  skipped?: boolean;
  attachmentPageInfo?: AttachmentPageInfo[];
}

export interface AttachmentPageInfo {
  originalName: string;
  pageCount: number;
  attachmentId: string;
  mimeType: string;
  size: number;
}

export interface EmailHeaders {
  subject: string;
  from: string;
  date: string;
}

export interface AutoProcessResult {
   success: boolean;
   totalEmails: number;
   processedEmails: number;
   failedEmails: number;
   emailResults: EmailProcessResult[];
   errors: string[];
   processingTime: number;
}

@Injectable()
export class EmailsService {
  private sessionId: string | null = null;
  private authenticatedUserEmail: string | null = null;

  constructor(
      private readonly gmailService: GmailService,
      private readonly attachmentsService: AttachmentsService,
      private readonly pdfService: PdfService,
      private readonly htmlService: HtmlService,
      private readonly puppeteerService: PuppeteerService,
      private readonly supabaseService: SupabaseService,
  ) {}

  async setSessionId(sessionId: string): Promise<void> {
      this.sessionId = sessionId;
      this.gmailService.setSessionId(sessionId);
      
      try {
          this.authenticatedUserEmail = await this.gmailService.getAuthenticatedUserEmail(sessionId);
      } catch (error) {
          this.authenticatedUserEmail = null;
      }
  }

  async processEmail(
    messageId: string, 
    pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    outputDir?: string
  ): Promise<EmailProcessResult> {
    const existingEmail = await this.supabaseService.findEmailByGmailId(messageId);
    if (existingEmail && this.isRuleAlreadyProcessed(existingEmail, pdfRule)) {
        const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
        const ruleData = existingEmail.convertedRules[pdfRule];
        
        return {
            ...email,
            attachments: [],
            pdfUrls: ruleData.filePaths || [],
            pdfRule: pdfRule,
            merged: pdfRule === PdfRule.MAIN_BODY_WITH_ATTACHMENT,
            skipped: true,
            attachmentPageInfo: []
        };
    }

    const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
    const attachments = this.attachmentsService.detectAttachments(email.payload);
    const downloadDir = this.ensureDownloadDir(outputDir);

    const emailHeaders: EmailHeaders = {
        subject: email.subject,
        from: email.from,
        date: email.date
    };

    try {
        const result = await this.generatePdfWithOptions(
            email, 
            attachments, 
            pdfRule, 
            downloadDir, 
            emailHeaders
        );

        return {
            ...email,
            attachments,
            ...result,
            pdfRule,
            merged: pdfRule === PdfRule.MAIN_BODY_WITH_ATTACHMENT
        };
    } catch (error) {
        await this.markRuleAsFailed(messageId, pdfRule, error.message);
        throw error;
    }
  }

  async processMultipleEmails(
      messageIds: string[],
      pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      outputDir?: string
  ): Promise<EmailProcessResult[]> {
      const processEmail = async (id: string): Promise<EmailProcessResult | null> => {
          try {
              return await this.processEmail(id, pdfRule, outputDir);
          } catch (error) {
              return null;
          }
      };

      const results = await Promise.all(messageIds.map(processEmail));
      return results.filter((result): result is EmailProcessResult => result !== null);
  }

  async autoProcessAllEmails(
      sessionId: string,
      maxEmails: number = 10,
      pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      outputDir?: string
  ): Promise<AutoProcessResult> {
      const startTime = Date.now();
      const errors: string[] = [];
      let emailResults: EmailProcessResult[] = [];

      try {
          await this.setSessionId(sessionId);
          
          const emailListResponse = await this.gmailService.getEmailList(maxEmails, sessionId);
          const messageIds = emailListResponse.emails.map(email => email.messageId);
          
          if (messageIds.length === 0) {
              return {
                  success: false,
                  totalEmails: 0,
                  processedEmails: 0,
                  failedEmails: 0,
                  emailResults: [],
                  errors: ['email list is empty'],
                  processingTime: Date.now() - startTime
              };
          }

          emailResults = await this.processMultipleEmails(messageIds, pdfRule, outputDir);
          
          const processedCount = emailResults.filter(result => !result.skipped).length;
          const failedCount = messageIds.length - emailResults.length;

          return {
              success: true,
              totalEmails: messageIds.length,
              processedEmails: processedCount,
              failedEmails: failedCount,
              emailResults,
              errors,
              processingTime: Date.now() - startTime
          };

      } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'unknown error';
          errors.push(`auto process failed: ${errorMessage}`);

          return {
              success: false,
              totalEmails: 0,
              processedEmails: 0,
              failedEmails: 0,
              emailResults,
              errors,
              processingTime: Date.now() - startTime
          };
      }
  }

  async getEmailPageCount(messageId: string): Promise<number> {
      try {
          const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
          const htmlContent = this.htmlService.createEmailHTML(email, []);
          const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
          const pdf = await PDFDocument.load(emailPdfBuffer);
          return pdf.getPageCount();
      } catch (error) {
          return 1;
      }
  }

  async getEmailProcessingStatus(messageId: string) {
      return await this.supabaseService.getEmailProcessingStatus(messageId);
  }

  async getRuleFiles(messageId: string, pdfRule: PdfRule): Promise<string[]> {
      return await this.supabaseService.getRuleFiles(messageId, pdfRule);
  }

  private isRuleAlreadyProcessed(existingEmail: any, pdfRule: PdfRule): boolean {
      const ruleData = existingEmail.convertedRules?.[pdfRule];
      return ruleData?.converted === true && ruleData.filePaths?.length > 0;
  }

  private async markRuleAsFailed(messageId: string, pdfRule: PdfRule, errorMessage: string): Promise<void> {
      await this.supabaseService.markRuleAsConverted(
          messageId,
          pdfRule,
          {
              converted: false,
              error: errorMessage,
              updatedAt: new Date().toISOString()
          }
      );
  }

  private async saveEmailToDatabase(email: any, uploadResults: any[], pdfRule: PdfRule): Promise<void> {
      const existingEmail = await this.supabaseService.findEmailByGmailId(email.messageId);
      
      const filePaths = uploadResults.map(r => r.url);
      const filenames = uploadResults.map(r => r.fileName);
      
      const ruleData = {
          converted: true,
          filenames: filenames,
          filePaths: filePaths,
          updatedAt: new Date().toISOString()
      };
      
      if (existingEmail) {
          await this.supabaseService.markRuleAsConverted(
              email.messageId,
              pdfRule,
              ruleData
          );
      } else {
          const emailRecord = {
              subject: email.subject,
              sender: email.from,
              receivedAt: new Date(email.date),
              converted: true,
              filePaths: uploadResults.map(r => ({
                  type: this.getFileType(r.fileName, pdfRule),
                  path: r.url
              })),
              gmailId: email.messageId,
              threadId: email.threadId || email.messageId,
              pdfRule: pdfRule,
              convertedRules: {
                  [pdfRule]: ruleData
              }
          };
          
          await this.supabaseService.insertEmail(emailRecord);
      }
  }

  private getFileType(fileName: string, pdfRule: PdfRule): string {
      if (pdfRule === PdfRule.MAIN_BODY_WITH_ATTACHMENT) {
          return 'merged';
      } else if (fileName.includes('_email_')) {
          return 'email';
      } else if (fileName.includes('_attachment_')) {
          return 'attachment';
      }
      return 'attachment';
  }

  private ensureDownloadDir(outputDir?: string): string {
      const downloadDir = outputDir || path.join(__dirname, 'downloads');
      if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
      }
      return downloadDir;
  }

  private async downloadAttachments(attachments: any[], messageId: string, downloadDir: string): Promise<{ paths: string[], names: string[] }> {
      const pdfAttachmentPaths: string[] = [];
      const attachmentNames: string[] = [];
      
      for (const attachment of attachments) {
          if (attachment.isPdf) {
              const attachmentPath = await this.gmailService.downloadAttachment(
                  messageId,
                  attachment.attachmentId,
                  attachment.filename,
                  downloadDir,
                  this.sessionId!
              );
              pdfAttachmentPaths.push(attachmentPath);
              attachmentNames.push(attachment.filename);
          }
      }

      return { paths: pdfAttachmentPaths, names: attachmentNames };
  }

  private async writeOutputFilesAndUpload(
   result: any, 
   pdfRule: PdfRule, 
   downloadDir: string,
   gmailId: string,
   authenticatedUserEmail: string
 ): Promise<{ localPaths: string[], uploadResults: any[] }> {
      const localPaths: string[] = [];
      
      if (result.mergedPdf) {
          const mergedPath = path.join(downloadDir, result.filenames[0]);
          fs.writeFileSync(mergedPath, result.mergedPdf);
          localPaths.push(mergedPath);
      }

      if (result.emailPdf) {
          const emailPath = path.join(downloadDir, result.filenames[0]);
          fs.writeFileSync(emailPath, result.emailPdf);
          localPaths.push(emailPath);
      }

      if (result.attachmentPdfs) {
          result.attachmentPdfs.forEach((attachmentBuffer: Buffer, index: number) => {
              const attachmentIndex = pdfRule === PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT ? index + 1 : index;
              const attachmentPath = path.join(downloadDir, result.filenames[attachmentIndex]);
              fs.writeFileSync(attachmentPath, attachmentBuffer);
              localPaths.push(attachmentPath);
          });
      }

      const safeUserEmail = authenticatedUserEmail.replace(/[@.]/g, '_');
      const folder = `${safeUserEmail}/${gmailId}/${pdfRule}`;
      const uploadResults = await this.supabaseService.uploadMultiplePdfs(localPaths, folder, result.filenames);
      
      localPaths.forEach(filePath => {
          if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
          }
      });

      return { localPaths, uploadResults };
  }

  private async generatePdfWithOptions(
      email: any, 
      attachments: any[], 
      pdfRule: PdfRule,
      downloadDir: string, 
      emailHeaders: EmailHeaders
  ) {
      const htmlContent = this.htmlService.createEmailHTML(email, attachments);
      const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
      
      const { paths: pdfAttachmentPaths, names: attachmentNames } = await this.downloadAttachments(
          attachments, 
          email.messageId, 
          downloadDir
      );

      const result = await this.pdfService.processPdfWithRule(
          emailPdfBuffer,
          pdfAttachmentPaths,
          emailHeaders,
          attachmentNames,
          pdfRule,
          email.messageId
      );

      const userEmail = this.authenticatedUserEmail || 'unknown_user';
      
      const { uploadResults } = await this.writeOutputFilesAndUpload(
          result, 
          pdfRule, 
          downloadDir,
          email.messageId,
          userEmail
      );
      
      const attachmentPageInfo = await this.analyzeAttachmentPages(attachments, pdfAttachmentPaths);
      
      this.pdfService.cleanupTempFiles(pdfAttachmentPaths);

      await this.saveEmailToDatabase(email, uploadResults, pdfRule);

      return {
          pdfUrls: uploadResults.map(r => r.url),
          attachmentPageInfo,
      };
  }
  
  private async analyzeAttachmentPages(attachments: any[], pdfAttachmentPaths: string[]): Promise<AttachmentPageInfo[]> {
      const attachmentPageInfo: AttachmentPageInfo[] = [];
      
      for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          
          if (attachment.isPdf && pdfAttachmentPaths[i]) {
              try {
                  const pdfBuffer = fs.readFileSync(pdfAttachmentPaths[i]);
                  const pdf = await PDFDocument.load(pdfBuffer);
                  const pageCount = pdf.getPageCount();
                  
                  attachmentPageInfo.push({
                      originalName: attachment.filename,
                      pageCount: pageCount,
                      attachmentId: attachment.attachmentId,
                      mimeType: attachment.mimeType,
                      size: attachment.size
                  });
              } catch (error) {
                  attachmentPageInfo.push({
                      originalName: attachment.filename,
                      pageCount: 1,
                      attachmentId: attachment.attachmentId,
                      mimeType: attachment.mimeType,
                      size: attachment.size
                  });
              }
          }
      }
      
      return attachmentPageInfo;
  }
}