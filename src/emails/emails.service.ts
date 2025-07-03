import { Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { DownloadService } from '../download/download.service';

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
   pdfPath: string;
   merged: boolean;
   skipped?: boolean;
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

@Injectable()
export class EmailsService {
   private sessionId: string | null = null;

   constructor(
       private readonly gmailService: GmailService,
       private readonly attachmentsService: AttachmentsService,
       private readonly pdfService: PdfService,
       private readonly htmlService: HtmlService,
       private readonly puppeteerService: PuppeteerService,
       private readonly downloadService: DownloadService,
   ) {}

   async processEmail(messageId: string, outputDir?: string): Promise<EmailProcessResult> {
    const email = await this.gmailService.getEmailById(messageId, this.sessionId!);
    const attachments = this.attachmentsService.detectAttachments(email.payload);
    const hasPdfAttachment = this.attachmentsService.hasPdfAttachment(attachments);
 
    const fileName = this.pdfService.generateSafeFileName(
        email.subject, 
        email.messageId, 
        hasPdfAttachment
    );
    
    const downloadDir = outputDir || path.join(__dirname, 'downloads');
    const outputPath = path.join(downloadDir, fileName);
 
    if (this.downloadService.checkDuplicateFile(fileName)) {
        return {
            ...email,
            attachments,
            pdfPath: outputPath,
            merged: hasPdfAttachment,
            skipped: true
        };
    }
 
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }
 
    const emailHeaders: EmailHeaders = {
        subject: email.subject,
        from: email.from,
        date: email.date
    };
 
    const result = await this.generatePdf(email, attachments, hasPdfAttachment, outputPath, downloadDir, emailHeaders);
 
    return {
        ...email,
        attachments,
        pdfPath: outputPath,
        ...result,
        merged: hasPdfAttachment,
    };
 }

   private async generatePdf(email: any, attachments: any[], hasPdfAttachment: boolean, outputPath: string, downloadDir: string, emailHeaders: EmailHeaders) {
       if (hasPdfAttachment) {
           return await this.generateMergedPdf(email, attachments, outputPath, downloadDir, emailHeaders);
       } else {
           return await this.generateEmailOnlyPdf(email, attachments, outputPath, emailHeaders);
       }
   }

   private async generateMergedPdf(email: any, attachments: any[], outputPath: string, downloadDir: string, emailHeaders: EmailHeaders) {
       const htmlContent = this.htmlService.createEmailHTML(email, attachments);
       const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
       
       const pdfAttachmentPaths: string[] = [];
       const attachmentNames: string[] = [];
       
       for (const attachment of attachments) {
           if (attachment.isPdf) {
               const attachmentPath = await this.gmailService.downloadAttachment(
                   email.messageId,
                   attachment.attachmentId,
                   attachment.filename,
                   downloadDir,
                   this.sessionId!
               );
               pdfAttachmentPaths.push(attachmentPath);
               attachmentNames.push(attachment.filename);
           }
       }

       const attachmentPageInfo = await this.analyzeAttachmentPages(attachments, pdfAttachmentPaths);
       const mergedPdfBuffer = await this.pdfService.mergePDFs(
           emailPdfBuffer, 
           pdfAttachmentPaths, 
           emailHeaders, 
           attachmentNames
       );
       
       fs.writeFileSync(outputPath, mergedPdfBuffer);
       this.pdfService.cleanupTempFiles(pdfAttachmentPaths);

       return { 
           merged: true,
           attachmentPageInfo 
       };
   }

   private async generateEmailOnlyPdf(email: any, attachments: any[], outputPath: string, emailHeaders: EmailHeaders) {
       const htmlContent = this.htmlService.createEmailHTML(email, attachments);
       const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(htmlContent, null!, true);
       const processedPdfBuffer = await this.pdfService.createEmailOnlyPDF(emailPdfBuffer, emailHeaders);
       
       fs.writeFileSync(outputPath, processedPdfBuffer);
       
       return { merged: false };
   }

   async processMultipleEmails(
    messageIds: string[],
    outputDir?: string
  ): Promise<EmailProcessResult[]> {
    const tasks = messageIds.map(async (id) => {
      try {
        const result = await this.processEmail(id, outputDir);
        return result;
      } catch (error) {
        console.error(`Failed to process email ${id}:`, error);
        return null;
      }
    });
  
    const results = await Promise.all(tasks);
    return results.filter((result): result is EmailProcessResult => result !== null);
  }
  
  
   async demergePdf(mergedPdfPath: string, emailPageCount: number, attachmentPageInfo: AttachmentPageInfo[], outputDir?: string, emailHeaders?: EmailHeaders): Promise<any> {
       const demergeDir = outputDir || path.dirname(mergedPdfPath);
       
       const attachmentInfo = attachmentPageInfo.map(info => ({
           originalName: info.originalName,
           pageCount: info.pageCount
       }));

       const results = await this.pdfService.demergePDF(
           mergedPdfPath,
           emailPageCount,
           attachmentInfo,
           demergeDir,
           emailHeaders
       );

       return results;
   }

   setSessionId(sessionId: string): void {
       this.sessionId = sessionId;
       this.gmailService.setSessionId(sessionId);
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
}