import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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

  private async addHeaderToPdf(
    pdfDoc: PDFDocument, 
    headerText: string, 
    position: 'top' | 'bottom' = 'top'
  ): Promise<void> {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      const pageText = headerText.replace('{pageNumber}', (i + 1).toString())
                                .replace('{totalPages}', pages.length.toString());
      const textWidth = font.widthOfTextAtSize(pageText, position === 'bottom' ? 9 : 10);
      const x = position === 'top' ? 40 : (width - textWidth) / 2;
      const y = position === 'bottom' ? 20 : height - 30;
      
      page.drawText(pageText, {
        x: x,
        y: y,
        size: position === 'bottom' ? 9 : 10,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  async addBasicFooter(pdfDoc: PDFDocument): Promise<void> {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const currentDateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const footerText = `Page {pageNumber} of {totalPages} | Generated: ${currentDateTime}`;
    
    await this.addHeaderToPdf(pdfDoc, footerText, 'bottom');
  }

  async addEmailMainBodyHeader(pdfDoc: PDFDocument, subject: string, from: string, date: string): Promise<void> {
    const headerText = `[Email Main Body] page {pageNumber} of {totalPages}`;
    await this.addHeaderToPdf(pdfDoc, headerText, 'top');
  }

  async addAttachmentHeader(pdfDoc: PDFDocument, attachmentName: string): Promise<void> {
    const headerText = `[Attachment] page {pageNumber} of {totalPages}`;
    await this.addHeaderToPdf(pdfDoc, headerText, 'top');
  }

  private async processEmailPdf(emailPdfBuffer: Buffer, emailHeaders: EmailHeaders): Promise<Buffer> {
    const emailPdf = await PDFDocument.load(emailPdfBuffer);
    await this.addEmailMainBodyHeader(emailPdf, emailHeaders.subject, emailHeaders.from, emailHeaders.date);
    await this.addBasicFooter(emailPdf);
    const processedPdfBuffer = await emailPdf.save();
    return Buffer.from(processedPdfBuffer);
  }

  private async processAttachmentPdf(pdfPath: string, attachmentName: string): Promise<Buffer> {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdf = await PDFDocument.load(pdfBuffer);
    await this.addAttachmentHeader(pdf, attachmentName);
    await this.addBasicFooter(pdf);
    const processedPdfBuffer = await pdf.save();
    return Buffer.from(processedPdfBuffer);
  }

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
          attachmentNames,
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
    attachmentNames: string[],
    messageId: string
  ): Promise<PdfProcessResult> {
    const mergedPdf = await PDFDocument.create();
    
    const emailPdf = await PDFDocument.load(emailPdfBuffer);
    await this.addEmailMainBodyHeader(emailPdf, emailHeaders.subject, emailHeaders.from, emailHeaders.date);
    const emailPages = await mergedPdf.copyPages(emailPdf, emailPdf.getPageIndices());
    emailPages.forEach((page) => mergedPdf.addPage(page));

    for (let i = 0; i < attachmentPaths.length; i++) {
      const attachmentPath = attachmentPaths[i];
      try {
        const attachmentBuffer = fs.readFileSync(attachmentPath);
        const attachmentPdf = await PDFDocument.load(attachmentBuffer);
        const attachmentName = attachmentNames[i] || attachmentPath;
        await this.addAttachmentHeader(attachmentPdf, attachmentName);
        const attachmentPages = await mergedPdf.copyPages(
          attachmentPdf, 
          attachmentPdf.getPageIndices()
        );
        attachmentPages.forEach((page) => mergedPdf.addPage(page));
      } catch (error) {
        console.error(`Failed to merge attachment ${attachmentPath}:`, error);
      }
    }

    await this.addBasicFooter(mergedPdf);
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

    const processedEmailPdf = await this.processEmailPdf(emailPdfBuffer, emailHeaders);
    const emailFilename = this.generateFilename(emailHeaders, messageId, 'email');
    filenames.push(emailFilename);

    for (let i = 0; i < attachmentPaths.length; i++) {
      const attachmentPath = attachmentPaths[i];
      const attachmentName = attachmentNames[i];
      
      try {
        const processedAttachmentBuffer = await this.processAttachmentPdf(attachmentPath, attachmentName);
        attachmentPdfs.push(processedAttachmentBuffer);
        
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
      emailPdf: processedEmailPdf,
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
        const processedAttachmentBuffer = await this.processAttachmentPdf(attachmentPath, attachmentName);
        attachmentPdfs.push(processedAttachmentBuffer);
        
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