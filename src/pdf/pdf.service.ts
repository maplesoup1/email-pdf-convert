import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import { PdfRule } from '../emails/emails.entity';

interface PdfProcessResult {
  mergedPdf?: Buffer;
  emailPdf?: Buffer;
  attachmentPdfs?: Buffer[];
  filenames: string[];
}

interface EmailHeaders {
  subject: string;
  from: string;
  date: string;
}

@Injectable()
export class PdfService {

  async processPdfWithRule(
    emailPdfBuffer: Buffer,
    attachmentPaths: string[],
    emailHeaders: EmailHeaders,
    attachmentNames: string[],
    pdfRule: PdfRule,
    messageId: string
  ): Promise<PdfProcessResult> {
    
    switch (pdfRule) {
      case PdfRule.MAIN_BODY_WITH_ATTACHMENT:
        return this.mergeEmailWithAttachments(
          emailPdfBuffer, 
          attachmentPaths, 
          emailHeaders, 
          messageId
        );

      case PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT:
        return this.separateEmailAndAttachments(
          emailPdfBuffer, 
          attachmentPaths, 
          emailHeaders, 
          attachmentNames, 
          messageId
        );

      case PdfRule.ATTACHMENT_ONLY:
        return this.attachmentOnly(
          attachmentPaths, 
          attachmentNames, 
          emailHeaders, 
          messageId
        );

      default:
        throw new Error(`Unsupported PDF rule: ${pdfRule}`);
    }
  }

  private async mergeEmailWithAttachments(
    emailPdfBuffer: Buffer,
    attachmentPaths: string[],
    emailHeaders: EmailHeaders,
    messageId: string
  ): Promise<PdfProcessResult> {
    const mergedPdf = await PDFDocument.create();
    
    const emailPdf = await PDFDocument.load(emailPdfBuffer);
    const emailPages = await mergedPdf.copyPages(emailPdf, emailPdf.getPageIndices());
    emailPages.forEach((page) => mergedPdf.addPage(page));

    for (const attachmentPath of attachmentPaths) {
      try {
        const attachmentBuffer = fs.readFileSync(attachmentPath);
        const attachmentPdf = await PDFDocument.load(attachmentBuffer);
        const attachmentPages = await mergedPdf.copyPages(
          attachmentPdf, 
          attachmentPdf.getPageIndices()
        );
        attachmentPages.forEach((page) => mergedPdf.addPage(page));
      } catch (error) {
        console.error(`Failed to merge attachment ${attachmentPath}:`, error);
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    const filename = this.generateFilename(emailHeaders, messageId, 'merged');

    return {
      mergedPdf: Buffer.from(mergedPdfBytes),
      filenames: [filename]
    };
  }

  private async separateEmailAndAttachments(
    emailPdfBuffer: Buffer,
    attachmentPaths: string[],
    emailHeaders: EmailHeaders,
    attachmentNames: string[],
    messageId: string
  ): Promise<PdfProcessResult> {
    const attachmentPdfs: Buffer[] = [];
    const filenames: string[] = [];

    const emailFilename = this.generateFilename(emailHeaders, messageId, 'email');
    filenames.push(emailFilename);

    for (let i = 0; i < attachmentPaths.length; i++) {
      const attachmentPath = attachmentPaths[i];
      const attachmentName = attachmentNames[i];
      
      try {
        const attachmentBuffer = fs.readFileSync(attachmentPath);
        attachmentPdfs.push(attachmentBuffer);
        
        const attachmentFilename = this.generateAttachmentFilename(
          emailHeaders, 
          messageId, 
          attachmentName, 
          i
        );
        filenames.push(attachmentFilename);
      } catch (error) {
        console.error(`Failed to process attachment ${attachmentPath}:`, error);
      }
    }

    return {
      emailPdf: emailPdfBuffer,
      attachmentPdfs,
      filenames
    };
  }

  private async attachmentOnly(
    attachmentPaths: string[],
    attachmentNames: string[],
    emailHeaders: EmailHeaders,
    messageId: string
  ): Promise<PdfProcessResult> {
    const attachmentPdfs: Buffer[] = [];
    const filenames: string[] = [];

    for (let i = 0; i < attachmentPaths.length; i++) {
      const attachmentPath = attachmentPaths[i];
      const attachmentName = attachmentNames[i];
      
      try {
        const attachmentBuffer = fs.readFileSync(attachmentPath);
        attachmentPdfs.push(attachmentBuffer);
        
        const attachmentFilename = this.generateAttachmentFilename(
          emailHeaders, 
          messageId, 
          attachmentName, 
          i
        );
        filenames.push(attachmentFilename);
      } catch (error) {
        console.error(`Failed to process attachment ${attachmentPath}:`, error);
      }
    }

    return {
      attachmentPdfs,
      filenames
    };
  }

  generateFilename(
    emailHeaders: EmailHeaders, 
    messageId: string, 
    type: string
  ): string {
    const sanitizedSubject = this.sanitizeFilename(emailHeaders.subject);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `${timestamp}_${sanitizedSubject}_${type}_${messageId.slice(-8)}.pdf`;
  }

  private generateAttachmentFilename(
    emailHeaders: EmailHeaders,
    messageId: string,
    originalName: string,
    index: number
  ): string {
    const sanitizedSubject = this.sanitizeFilename(emailHeaders.subject);
    const sanitizedOriginalName = this.sanitizeFilename(
      originalName.replace(/\.pdf$/i, '')
    );
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `${timestamp}_${sanitizedSubject}_attachment_${index + 1}_${sanitizedOriginalName}_${messageId.slice(-8)}.pdf`;
  }

  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  async getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    try {
      const pdf = await PDFDocument.load(pdfBuffer);
      return pdf.getPageCount();
    } catch (error) {
      console.error('Failed to get PDF page count:', error);
      return 1;
    }
  }

  cleanupTempFiles(filePaths: string[]): void {
    filePaths.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Failed to cleanup temp file ${filePath}:`, error);
      }
    });
  }
}