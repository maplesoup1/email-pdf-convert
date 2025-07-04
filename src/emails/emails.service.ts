import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PdfService, PdfProcessingOption } from '../pdf/pdf.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { SupabaseService } from '../supabase/supabase.service';

interface EmailProcessResult {
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
  processingOption: PdfProcessingOption;
  merged: boolean;
  skipped?: boolean;
  attachmentPageInfo?: AttachmentPageInfo[];
}

interface AttachmentPageInfo {
  originalName: string;
  pageCount: number;
  attachmentId: string;
  mimeType: string;
  size: number;
}

interface EmailHeaders {
  subject: string;
  from: string;
  date: string;
}

interface AutoProcessResult {
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
          console.error('Failed to get authenticated user email:', error);
          this.authenticatedUserEmail = null;
      }
  }
  
  private async saveEmailToDatabase(email: any, uploadResults: any[]): Promise<void> {
      try {
          const existingEmail = await this.supabaseService.findEmailByGmailId(email.messageId);
          
          if (existingEmail) {
              await this.supabaseService.markAsConverted(
                  email.messageId, 
                  uploadResults.map(r => r.url)
              );
          } else {
              const emailRecord = {
                  subject: email.subject,
                  sender: email.from,
                  received_at: new Date(email.date),
                  converted: true,
                  file_paths: uploadResults.map(r => r.url),
                  gmail_id: email.messageId,
                  thread_id: email.threadId || email.messageId
              };
              
              await this.supabaseService.insertEmail(emailRecord);
          }
      } catch (error) {
          console.error('Failed to save email to database:', error);
      }
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
   processingOption: PdfProcessingOption, 
   downloadDir: string,
   gmailId: string,
   authenticatedUserEmail: string
 ): Promise<{ localPaths: string[], uploadResults: any[] }> {
      const localPaths: string[] = [];
      const uploadResults: any[] = [];
      
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
              const attachmentIndex = processingOption === PdfProcessingOption.SEPARATE_EMAIL_AND_ATTACHMENTS ? index + 1 : index;
              const attachmentPath = path.join(downloadDir, result.filenames[attachmentIndex]);
              fs.writeFileSync(attachmentPath, attachmentBuffer);
              localPaths.push(attachmentPath);
          });
      }

      try {
       const safeUserEmail = authenticatedUserEmail.replace(/[@.]/g, '_');
       const folder = `emails/${safeUserEmail}`;
          const uploadResults = await this.supabaseService.uploadMultiplePdfs(localPaths, folder);
          
          localPaths.forEach(filePath => {
              try {
                  fs.unlinkSync(filePath);
              } catch (error) {
                  console.error(`Failed to delete temp file ${filePath}:`, error);
              }
          });

          return { localPaths, uploadResults };
      } catch (error) {
          console.error('Failed to upload PDFs to Supabase:', error);
          return { localPaths, uploadResults: [] };
      }
  }

  async processEmail(
    messageId: string, 
    processingOption: PdfProcessingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS,
    outputDir?: string
): Promise<EmailProcessResult> {
    // 先检查是否已经处理过
    const existingEmail = await this.supabaseService.findEmailByGmailId(messageId);
    if (existingEmail && existingEmail.converted && existingEmail.file_paths?.length > 0) {
        console.log('Email already processed, skipping:', messageId);
        
        // 获取基本邮件信息用于返回
        const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
        return {
            ...email,
            attachments: [],
            pdfUrls: existingEmail.file_paths,
            processingOption,
            merged: processingOption === PdfProcessingOption.MERGE_WITH_ATTACHMENTS,
            skipped: true,
            attachmentPageInfo: []
        };
    }

    // 如果没有处理过，继续正常流程
    const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
    const attachments = this.attachmentsService.detectAttachments(email.payload);
    const downloadDir = this.ensureDownloadDir(outputDir);

    const emailHeaders: EmailHeaders = {
        subject: email.subject,
        from: email.from,
        date: email.date
    };

    const result = await this.generatePdfWithOptions(
        email, 
        attachments, 
        processingOption, 
        downloadDir, 
        emailHeaders
    );

    return {
        ...email,
        attachments,
        ...result,
        processingOption,
        merged: processingOption === PdfProcessingOption.MERGE_WITH_ATTACHMENTS
    };
}

  private async generatePdfWithOptions(
      email: any, 
      attachments: any[], 
      processingOption: PdfProcessingOption,
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

      const result = await this.pdfService.processPdfWithOptions(
          emailPdfBuffer,
          pdfAttachmentPaths,
          emailHeaders,
          attachmentNames,
          processingOption,
          email.messageId
      );

      const userEmail = this.authenticatedUserEmail || 'unknown_user';
      
      const { uploadResults } = await this.writeOutputFilesAndUpload(
          result, 
          processingOption, 
          downloadDir,
          email.messageId,
          userEmail
      );
      
      const attachmentPageInfo = await this.analyzeAttachmentPages(attachments, pdfAttachmentPaths);
      
      this.pdfService.cleanupTempFiles(pdfAttachmentPaths);

      await this.saveEmailToDatabase(email, uploadResults);

      return {
          pdfUrls: uploadResults.map(r => r.url),
          attachmentPageInfo,
      };
  }

  async processMultipleEmails(
      messageIds: string[],
      processingOption: PdfProcessingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS,
      outputDir?: string
  ): Promise<EmailProcessResult[]> {
      const processEmail = async (id: string): Promise<EmailProcessResult | null> => {
          try {
              return await this.processEmail(id, processingOption, outputDir);
          } catch (error) {
              console.error(`Failed to process email ${id}:`, error);
              return null;
          }
      };

      const results = await Promise.all(messageIds.map(processEmail));
      return results.filter((result): result is EmailProcessResult => result !== null);
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
                  console.error(`Failed to analyze PDF ${attachment.filename}:`, error);
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

  async getEmailPageCount(messageId: string): Promise<number> {
      try {
          const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
          const htmlContent = this.htmlService.createEmailHTML(email, []);
          const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
          const pdf = await PDFDocument.load(emailPdfBuffer);
          return pdf.getPageCount();
      } catch (error) {
          console.error('Failed to get email page count:', error);
          return 1;
      }
  }

  async autoProcessAllEmails(
      sessionId: string,
      maxEmails: number = 10,
      processingOption: PdfProcessingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS,
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

          emailResults = await this.processMultipleEmails(messageIds, processingOption, outputDir);
          
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
}