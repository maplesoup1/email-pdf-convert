import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { PdfRule } from '../emails/emails.entity';

export enum EmailProvider {
  GMAIL = 'gmail',
  OUTLOOK = 'outlook'
}

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
  provider: EmailProvider;
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
   provider: EmailProvider;
}

@Injectable()
export class EmailsService {
  private sessionId: string | null = null;
  private authenticatedUserEmail: string | null = null;
  private currentProvider: EmailProvider | null = null;

  constructor(
      private readonly gmailService: GmailService,
      private readonly outlookService: OutlookService,
      private readonly attachmentsService: AttachmentsService,
      private readonly pdfService: PdfService,
      private readonly htmlService: HtmlService,
      private readonly puppeteerService: PuppeteerService,
      private readonly supabaseService: SupabaseService,
      private readonly authService: AuthService,
  ) {}

  async setSessionId(sessionId: string, provider: EmailProvider): Promise<void> {
      this.sessionId = sessionId;
      this.currentProvider = provider;
      
      if (provider === EmailProvider.GMAIL) {
          this.gmailService.setSessionId(sessionId);
          try {
              this.authenticatedUserEmail = await this.gmailService.getAuthenticatedUserEmail(sessionId);
          } catch (error) {
              this.authenticatedUserEmail = null;
          }
      } else if (provider === EmailProvider.OUTLOOK) {
          this.outlookService.setSessionId(sessionId);
          try {
              this.authenticatedUserEmail = await this.outlookService.getAuthenticatedUserEmail(sessionId);
          } catch (error) {
              this.authenticatedUserEmail = null;
          }
      }
  }

  async processEmail(
    messageId: string, 
    pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    outputDir?: string,
    provider?: EmailProvider
  ): Promise<EmailProcessResult> {
    console.log('=== Processing Email Start ===');
    console.log('Message ID:', messageId);
    console.log('PDF Rule:', pdfRule);
    console.log('Provider:', provider || this.currentProvider);
    
    const currentProvider = provider || this.currentProvider;
    if (!currentProvider) {
        throw new Error('Provider must be specified');
    }

    const existingEmail = await this.supabaseService.findEmailByGmailId(messageId);
    console.log('Existing email found:', !!existingEmail);
    console.log('Existing email data:', existingEmail);
    
    const isAlreadyProcessed = this.isRuleAlreadyProcessed(existingEmail, pdfRule);
    console.log('Is rule already processed:', isAlreadyProcessed);
    
    if (isAlreadyProcessed) {
        console.log('Skipping - rule already processed');
        const email = await this.getEmailById(messageId, currentProvider);
        const ruleData = existingEmail.converted_rules[pdfRule];
        
        return {
            ...email,
            attachments: [],
            pdfUrls: ruleData.filePaths || [],
            pdfRule: pdfRule,
            merged: pdfRule === PdfRule.MAIN_BODY_WITH_ATTACHMENT,
            skipped: true,
            attachmentPageInfo: [],
            provider: currentProvider
        };
    }

    console.log('Continuing with processing...');
    const email = await this.getEmailById(messageId, currentProvider);
    console.log('Email fetched - Subject:', email.subject);
    console.log('Email body length:', email.body?.length);
    console.log('Email isHtml:', email.isHtml);
    
    let attachments: any[] = [];
    if (currentProvider === EmailProvider.GMAIL) {
        attachments = this.attachmentsService.detectAttachments(email.payload);
        console.log('Gmail attachments detected:', attachments.length);
    } else if (currentProvider === EmailProvider.OUTLOOK) {
        try {
            const outlookAttachments = await this.outlookService.getEmailAttachments(messageId, this.sessionId!);
            attachments = this.attachmentsService.formatOutlookAttachments(outlookAttachments);
            console.log('Outlook attachments from separate call:', attachments.length);
        } catch (attachmentError) {
            console.warn('Failed to get Outlook attachments:', attachmentError);
            attachments = [];
        }
    }
    
    console.log('Final attachments count:', attachments.length);
    console.log('PDF attachments:', attachments.filter(a => a.isPdf).length);
    
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
            emailHeaders,
            currentProvider
        );

        return {
            ...email,
            attachments,
            ...result,
            pdfRule,
            merged: pdfRule === PdfRule.MAIN_BODY_WITH_ATTACHMENT,
            provider: currentProvider
        };
    } catch (error) {
        console.log('Error during processing:', error.message);
        console.log('Error stack:', error.stack);
        await this.markRuleAsFailed(messageId, pdfRule, error.message);
        throw error;
    }
  }

  async processMultipleEmails(
      messageIds: string[],
      pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      outputDir?: string,
      provider?: EmailProvider
  ): Promise<EmailProcessResult[]> {
      const currentProvider = provider || this.currentProvider;
      if (!currentProvider) {
          throw new Error('Provider must be specified');
      }

      const processEmail = async (id: string): Promise<EmailProcessResult | null> => {
          try {
              return await this.processEmail(id, pdfRule, outputDir, currentProvider);
          } catch (error) {
              console.error(`Failed to process email ${id}:`, error.message);
              return null;
          }
      };

      const results = await Promise.all(messageIds.map(processEmail));
      return results.filter((result): result is EmailProcessResult => result !== null);
  }

  async autoProcessAllEmails(
      sessionId: string,
      provider: EmailProvider,
      maxEmails: number = 10,
      pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      outputDir?: string
  ): Promise<AutoProcessResult> {
      const startTime = Date.now();
      const errors: string[] = [];
      let emailResults: EmailProcessResult[] = [];

      try {
          await this.setSessionId(sessionId, provider);
          
          const emailListResponse = await this.getEmailList(maxEmails, provider);
          const messageIds = emailListResponse.emails.map(email => email.messageId);
          
          if (messageIds.length === 0) {
              return {
                  success: false,
                  totalEmails: 0,
                  processedEmails: 0,
                  failedEmails: 0,
                  emailResults: [],
                  errors: ['email list is empty'],
                  processingTime: Date.now() - startTime,
                  provider
              };
          }

          emailResults = await this.processMultipleEmails(messageIds, pdfRule, outputDir, provider);
          
          const processedCount = emailResults.filter(result => !result.skipped).length;
          const failedCount = messageIds.length - emailResults.length;

          return {
              success: true,
              totalEmails: messageIds.length,
              processedEmails: processedCount,
              failedEmails: failedCount,
              emailResults,
              errors,
              processingTime: Date.now() - startTime,
              provider
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
              processingTime: Date.now() - startTime,
              provider
          };
      }
  }

  async getEmailPageCount(messageId: string, provider?: EmailProvider): Promise<number> {
      try {
          const currentProvider = provider || this.currentProvider;
          if (!currentProvider) {
              throw new Error('Provider must be specified');
          }

          const email = await this.getEmailById(messageId, currentProvider);
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

  private async getEmailById(messageId: string, provider: EmailProvider) {
      if (provider === EmailProvider.GMAIL) {
          return await this.gmailService.getEmailById(messageId, this.sessionId!);
      } else if (provider === EmailProvider.OUTLOOK) {
          return await this.outlookService.getEmailById(messageId, this.sessionId!);
      } else {
          throw new Error(`Unsupported provider: ${provider}`);
      }
  }

  private async getEmailList(maxEmails: number, provider: EmailProvider) {
      if (provider === EmailProvider.GMAIL) {
          return await this.gmailService.getEmailList(maxEmails, this.sessionId!);
      } else if (provider === EmailProvider.OUTLOOK) {
          return await this.outlookService.getEmailList(maxEmails, this.sessionId!);
      } else {
          throw new Error(`Unsupported provider: ${provider}`);
      }
  }

  private async downloadAttachments(
      attachments: any[], 
      messageId: string, 
      downloadDir: string, 
      provider: EmailProvider
  ): Promise<{ paths: string[], names: string[] }> {
      const pdfAttachmentPaths: string[] = [];
      const attachmentNames: string[] = [];
      
      console.log('=== Download Attachments Debug ===');
      console.log('Total attachments:', attachments.length);
      console.log('PDF attachments:', attachments.filter(a => a.isPdf).length);
      
      for (const attachment of attachments) {
          if (attachment.isPdf) {
              console.log(`Downloading PDF: ${attachment.filename}`);
              console.log(`Attachment ID: ${attachment.attachmentId}`);
              console.log(`MIME Type: ${attachment.mimeType}`);
              
              let attachmentPath: string;
              
              try {
                  if (provider === EmailProvider.GMAIL) {
                      attachmentPath = await this.gmailService.downloadAttachment(
                          messageId,
                          attachment.attachmentId,
                          attachment.filename,
                          downloadDir,
                          this.sessionId!
                      );
                  } else if (provider === EmailProvider.OUTLOOK) {
                      attachmentPath = await this.outlookService.downloadAttachment(
                          messageId,
                          attachment.attachmentId,
                          attachment.filename,
                          downloadDir,
                          this.sessionId!
                      );
                  } else {
                      throw new Error(`Unsupported provider: ${provider}`);
                  }
                  
                  console.log(`Downloaded to: ${attachmentPath}`);
                  console.log(`File exists: ${fs.existsSync(attachmentPath)}`);
                  if (fs.existsSync(attachmentPath)) {
                      console.log(`File size: ${fs.statSync(attachmentPath).size} bytes`);
                  }
                  
                  pdfAttachmentPaths.push(attachmentPath);
                  attachmentNames.push(attachment.filename);
              } catch (downloadError) {
                  console.error(`Failed to download ${attachment.filename}:`, downloadError.message);
              }
          }
      }

      console.log('Downloaded PDF paths:', pdfAttachmentPaths);
      return { paths: pdfAttachmentPaths, names: attachmentNames };
  }

  private isRuleAlreadyProcessed(existingEmail: any, pdfRule: PdfRule): boolean {
      console.log('=== Checking if rule already processed ===');
      console.log('existingEmail:', existingEmail);
      console.log('pdfRule:', pdfRule);
      
      if (!existingEmail || !existingEmail.converted_rules) {
          console.log('No existing email or converted_rules - allowing processing');
          return false;
      }
      
      console.log('converted_rules keys:', Object.keys(existingEmail.converted_rules));
      const ruleData = existingEmail.converted_rules[pdfRule];
      console.log('ruleData for', pdfRule, ':', ruleData);
      
      const result = ruleData?.converted === true;
      console.log('Final result:', result);
      return result;
  }

  private async markRuleAsFailed(messageId: string, pdfRule: PdfRule, errorMessage: string): Promise<void> {
      await this.supabaseService.markRuleAsConverted(
          messageId,
          pdfRule,
          {
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

  private async writeOutputFilesAndUpload(
   result: any, 
   pdfRule: PdfRule, 
   downloadDir: string,
   gmailId: string,
   authenticatedUserEmail: string
 ): Promise<{ localPaths: string[], uploadResults: any[] }> {
      const localPaths: string[] = [];
      
      console.log('=== Writing Output Files ===');
      console.log('Merged PDF exists:', !!result.mergedPdf);
      console.log('Email PDF exists:', !!result.emailPdf);
      console.log('Attachment PDFs count:', result.attachmentPdfs?.length || 0);
      console.log('Filenames:', result.filenames);
      
      if (result.mergedPdf) {
          const mergedPath = path.join(downloadDir, result.filenames[0]);
          fs.writeFileSync(mergedPath, result.mergedPdf);
          console.log(`Merged PDF written to: ${mergedPath}`);
          localPaths.push(mergedPath);
      }

      if (result.emailPdf) {
          const emailPath = path.join(downloadDir, result.filenames[0]);
          fs.writeFileSync(emailPath, result.emailPdf);
          console.log(`Email PDF written to: ${emailPath}`);
          localPaths.push(emailPath);
      }

      if (result.attachmentPdfs) {
          result.attachmentPdfs.forEach((attachmentBuffer: Buffer, index: number) => {
              const attachmentIndex = pdfRule === PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT ? index + 1 : index;
              const attachmentPath = path.join(downloadDir, result.filenames[attachmentIndex]);
              fs.writeFileSync(attachmentPath, attachmentBuffer);
              console.log(`Attachment PDF ${index + 1} written to: ${attachmentPath}`);
              localPaths.push(attachmentPath);
          });
      }

      const safeUserEmail = authenticatedUserEmail.replace(/[@.]/g, '_');
      const folder = `${safeUserEmail}/${gmailId}/${pdfRule}`;
      console.log(`Uploading to folder: ${folder}`);
      
      const uploadResults = await this.supabaseService.uploadMultiplePdfs(localPaths, folder, result.filenames);
      console.log('Upload results:', uploadResults.map(r => ({ fileName: r.fileName, url: r.url })));
      
      localPaths.forEach(filePath => {
          if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`Cleaned up: ${filePath}`);
          }
      });

      return { localPaths, uploadResults };
  }

  private async generatePdfWithOptions(
      email: any, 
      attachments: any[], 
      pdfRule: PdfRule,
      downloadDir: string, 
      emailHeaders: EmailHeaders,
      provider: EmailProvider
  ) {
      console.log('=== Generate PDF With Options ===');
      console.log('Email subject:', emailHeaders.subject);
      console.log('PDF Rule:', pdfRule);
      console.log('Provider:', provider);
      
      console.log('Creating HTML content...');
      const htmlContent = this.htmlService.createEmailHTML(email, attachments);
      console.log('HTML content length:', htmlContent.length);
      console.log('HTML preview:', htmlContent.substring(0, 200));
      
      console.log('Converting HTML to PDF...');
      const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
      console.log('Email PDF buffer size:', emailPdfBuffer.length);
      
      const { paths: pdfAttachmentPaths, names: attachmentNames } = await this.downloadAttachments(
          attachments, 
          email.messageId, 
          downloadDir,
          provider
      );

      console.log('Processing PDF with rule...');
      console.log('Email PDF buffer size:', emailPdfBuffer.length);
      console.log('Attachment paths:', pdfAttachmentPaths);
      console.log('Attachment names:', attachmentNames);
      
      const result = await this.pdfService.processPdfWithRule(
          emailPdfBuffer,
          pdfAttachmentPaths,
          emailHeaders,
          attachmentNames,
          pdfRule,
          email.messageId
      );
      
      console.log('PDF processing result:', {
          mergedPdf: !!result.mergedPdf,
          emailPdf: !!result.emailPdf,
          attachmentPdfs: result.attachmentPdfs?.length || 0,
          filenames: result.filenames
      });

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
                  console.error(`Failed to analyze attachment ${attachment.filename}:`, error);
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

  async createOutlookWebhook(
      sessionId: string,
      webhookBaseUrl: string,
      autoConvert: string = 'true',
      pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      outputDir?: string,
      notifyUrl?: string
  ): Promise<any> {
      const token = await this.authService.getOutlookAccessToken(sessionId);
      const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      
      let webhookUrl = `${webhookBaseUrl}/api/webhooks/outlook?sessionId=${sessionId}`;
      
      if (autoConvert === 'true' || autoConvert === '1') {
          webhookUrl += '&autoConvert=true';
          
          if (pdfRule) {
              webhookUrl += `&pdfRule=${pdfRule}`;
          }
          
          if (outputDir) {
              webhookUrl += `&outputDir=${encodeURIComponent(outputDir)}`;
          }
          
          if (notifyUrl) {
              webhookUrl += `&notifyUrl=${encodeURIComponent(notifyUrl)}`;
          }
      }
      
      const subscriptionPayload = {
          changeType: 'created',
          notificationUrl: webhookUrl,
          resource: "me/mailFolders('Inbox')/messages",
          expirationDateTime: expiration.toISOString(),
          clientState: 'secure-state-123'
      };

      const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(subscriptionPayload)
      });

      const data = await response.json();

      if (!response.ok) {
          throw new Error(`Graph API Error: ${data.error?.message || response.statusText}`);
      }

      const subscriptionInfo = {
          subscriptionId: data.id,
          expirationDateTime: data.expirationDateTime,
          resource: data.resource,
          webhookUrl,
          autoConvert: autoConvert === 'true' || autoConvert === '1',
          pdfRule: pdfRule || PdfRule.MAIN_BODY_WITH_ATTACHMENT,
          outputDir: outputDir || 'default',
          notifyUrl: notifyUrl || 'none',
          createdAt: new Date().toISOString()
      };
      
      const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
      fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionInfo, null, 2));
      
      return subscriptionInfo;
  }
}