import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface AttachmentInfo {
   originalName: string;
   pageCount: number;
}

interface EmailHeaders {
   subject: string;
   from: string;
   date: string;
}

export enum PdfProcessingOption {
   MERGE_WITH_ATTACHMENTS = 'merge_with_attachments',
   EMAIL_BODY_ONLY = 'email_body_only',
   SEPARATE_EMAIL_AND_ATTACHMENTS = 'separate_email_and_attachments',
   ATTACHMENTS_ONLY = 'attachments_only'
}

interface PdfProcessingResult {
   option: PdfProcessingOption;
   emailPdf?: Buffer;
   attachmentPdfs?: Buffer[];
   mergedPdf?: Buffer;
   filenames: string[];
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
           const x = (width - textWidth) / 2;
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
       const headerText = `This is email main body page {pageNumber} of {totalPages}`;
       await this.addHeaderToPdf(pdfDoc, headerText, 'top');
   }

   async addAttachmentHeader(pdfDoc: PDFDocument, attachmentName: string): Promise<void> {
       const headerText = `This is attachment page {pageNumber} of {totalPages}`;
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

   async processPdfWithOptions(
       emailPdfBuffer: Buffer,
       attachmentPdfPaths: string[],
       emailHeaders: EmailHeaders,
       attachmentNames: string[],
       option: PdfProcessingOption,
       messageId: string
   ): Promise<PdfProcessingResult> {
       const result: PdfProcessingResult = {
           option,
           filenames: []
       };

       const handlers = {
           [PdfProcessingOption.MERGE_WITH_ATTACHMENTS]: async () => {
               result.mergedPdf = await this.mergePDFs(emailPdfBuffer, attachmentPdfPaths, emailHeaders, attachmentNames);
               result.filenames.push(this.generateSafeFileName(emailHeaders.subject, messageId, true));
           },
           [PdfProcessingOption.EMAIL_BODY_ONLY]: async () => {
               result.emailPdf = await this.processEmailPdf(emailPdfBuffer, emailHeaders);
               result.filenames.push(this.generateSafeFileName(emailHeaders.subject, messageId, false));
           },
           [PdfProcessingOption.SEPARATE_EMAIL_AND_ATTACHMENTS]: async () => {
               result.emailPdf = await this.processEmailPdf(emailPdfBuffer, emailHeaders);
               result.filenames.push(this.generateSafeFileName(emailHeaders.subject, messageId, false));
               
               result.attachmentPdfs = await this.processAttachmentsOnly(attachmentPdfPaths, attachmentNames);
               attachmentNames.forEach((name, index) => {
                   result.filenames.push(this.generateAttachmentFileName(name, messageId, index));
               });
           },
           [PdfProcessingOption.ATTACHMENTS_ONLY]: async () => {
               result.attachmentPdfs = await this.processAttachmentsOnly(attachmentPdfPaths, attachmentNames);
               attachmentNames.forEach((name, index) => {
                   result.filenames.push(this.generateAttachmentFileName(name, messageId, index));
               });
           }
       };

       const handler = handlers[option];
       if (!handler) {
           throw new Error(`Unsupported processing option: ${option}`);
       }

       await handler();
       return result;
   }

   async processAttachmentsOnly(attachmentPdfPaths: string[], attachmentNames: string[]): Promise<Buffer[]> {
       const attachmentBuffers: Buffer[] = [];
       
       for (let i = 0; i < attachmentPdfPaths.length; i++) {
           const pdfPath = attachmentPdfPaths[i];
           if (fs.existsSync(pdfPath)) {
               const attachmentName = attachmentNames[i] || path.basename(pdfPath);
               const processedBuffer = await this.processAttachmentPdf(pdfPath, attachmentName);
               attachmentBuffers.push(processedBuffer);
           }
       }
       
       return attachmentBuffers;
   }

   async mergePDFs(emailPdfBuffer: Buffer, attachmentPdfPaths: string[], emailHeaders: EmailHeaders, attachmentNames: string[]): Promise<Buffer> {
       const mergedPdf = await PDFDocument.create();
       
       const emailPdf = await PDFDocument.load(emailPdfBuffer);
       await this.addEmailMainBodyHeader(emailPdf, emailHeaders.subject, emailHeaders.from, emailHeaders.date);
       const emailPages = await mergedPdf.copyPages(emailPdf, emailPdf.getPageIndices());
       emailPages.forEach((page) => mergedPdf.addPage(page));
       
       for (let i = 0; i < attachmentPdfPaths.length; i++) {
           const pdfPath = attachmentPdfPaths[i];
           if (fs.existsSync(pdfPath)) {
               console.log(`Merging: ${path.basename(pdfPath)}`);
               const pdfBuffer = fs.readFileSync(pdfPath);
               const pdf = await PDFDocument.load(pdfBuffer);
               
               const attachmentName = attachmentNames[i] || path.basename(pdfPath);
               await this.addAttachmentHeader(pdf, attachmentName);
               
               const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
               pages.forEach((page) => mergedPdf.addPage(page));
           }
       }
       
       await this.addBasicFooter(mergedPdf);
       const mergedPdfBuffer = await mergedPdf.save();
       return Buffer.from(mergedPdfBuffer);
   }

   async createEmailOnlyPDF(emailPdfBuffer: Buffer, emailHeaders: EmailHeaders): Promise<Buffer> {
       return this.processEmailPdf(emailPdfBuffer, emailHeaders);
   }

   private sanitizeFileName(name: string): string {
       return name
           .replace(/[<>:"/\\|?*]/g, '_')
           .replace(/\s+/g, '_')
           .substring(0, 50);
   }

   private getTimestamp(): string {
       return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
   }

   generateSafeFileName(subject: string, messageId: string, isMerged: boolean = false): string {
       const safeSubject = this.sanitizeFileName(subject);
       const timestamp = this.getTimestamp();
       const suffix = isMerged ? '_merged' : '';
       
       return `${safeSubject}_${timestamp}_${messageId.substring(0, 8)}${suffix}.pdf`;
   }

   generateAttachmentFileName(attachmentName: string, messageId: string, index: number): string {
       const safeAttachmentName = this.sanitizeFileName(attachmentName);
       const timestamp = this.getTimestamp();
       
       return `attachment_${index + 1}_${safeAttachmentName}_${timestamp}_${messageId.substring(0, 8)}.pdf`;
   }

   cleanupTempFiles(filePaths: string[]): void {
       filePaths.forEach(filePath => {
           if (fs.existsSync(filePath)) {
               const stats = fs.statSync(filePath);
               if (stats.isFile()) {
                   fs.unlinkSync(filePath);
               }
           }
       });
   }
}