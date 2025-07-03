import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface AttachmentInfo {
   originalName: string;
   pageCount: number;
}

interface DemergePdfResult {
   type: 'email' | 'attachment';
   filename: string;
   path: string;
   pageCount: number;
   originalName?: string;
}

interface EmailHeaders {
   subject: string;
   from: string;
   date: string;
}

@Injectable()
export class PdfService {
   async addBasicFooter(pdfDoc: PDFDocument): Promise<void> {
       const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
       const pages = pdfDoc.getPages();
       const now = new Date();
       const pad = (n: number): string => String(n).padStart(2, '0');
       const currentDateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
       
       for (let i = 0; i < pages.length; i++) {
           const page = pages[i];
           const { width } = page.getSize();
           const pageText = `Page ${i + 1} of ${pages.length} | Generated: ${currentDateTime}`;
           const textWidth = font.widthOfTextAtSize(pageText, 9);
           const x = (width - textWidth) / 2;
           
           page.drawText(pageText, {
               x: x,
               y: 20,
               size: 9,
               font: font,
               color: rgb(0.5, 0.5, 0.5),
           });
       }
   }

   async addEmailMainBodyHeader(pdfDoc: PDFDocument, subject: string, from: string, date: string): Promise<void> {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width } = page.getSize();
        const pageText = `This is email main body page ${i + 1} of ${pages.length}`;
        const textWidth = font.widthOfTextAtSize(pageText, 10);
        const x = (width - textWidth) / 2;
        
        page.drawText(pageText, {
            x: x,
            y: page.getHeight() - 30,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
        });
    }
 }

 async addAttachmentHeader(pdfDoc: PDFDocument, attachmentName: string): Promise<void> {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width } = page.getSize();
        const pageText = `This is attachment page ${i + 1} of ${pages.length}`;
        const textWidth = font.widthOfTextAtSize(pageText, 10);
        const x = (width - textWidth) / 2;
        
        page.drawText(pageText, {
            x: x,
            y: page.getHeight() - 30,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
        });
    }
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
       const emailPdf = await PDFDocument.load(emailPdfBuffer);
       await this.addEmailMainBodyHeader(emailPdf, emailHeaders.subject, emailHeaders.from, emailHeaders.date);
       await this.addBasicFooter(emailPdf);
       const processedPdfBuffer = await emailPdf.save();
       return Buffer.from(processedPdfBuffer);
   }

   async demergePDF(mergedPdfPath: string, emailPageCount: number, attachmentInfo: AttachmentInfo[], outputDir: string, emailHeaders?: EmailHeaders): Promise<DemergePdfResult[]> {
       const mergedPdfBuffer = fs.readFileSync(mergedPdfPath);
       const mergedPdf = await PDFDocument.load(mergedPdfBuffer);
       const totalPages = mergedPdf.getPageCount();
       const results: DemergePdfResult[] = [];
       
       if (!fs.existsSync(outputDir)) {
           fs.mkdirSync(outputDir, { recursive: true });
       }
       
       if (emailPageCount > 0) {
           const emailPdf = await PDFDocument.create();
           const emailPages = await emailPdf.copyPages(mergedPdf, Array.from({ length: emailPageCount }, (_, i) => i));
           emailPages.forEach(page => emailPdf.addPage(page));
           
           if (emailHeaders) {
               await this.addEmailMainBodyHeader(emailPdf, emailHeaders.subject, emailHeaders.from, emailHeaders.date);
           }
           
           await this.addBasicFooter(emailPdf);
           const emailPdfBuffer = await emailPdf.save();
           const emailFilename = path.basename(mergedPdfPath).replace('_merged', '_email_only');
           const emailPath = path.join(outputDir, emailFilename);
           
           fs.writeFileSync(emailPath, emailPdfBuffer);
           
           results.push({
               type: 'email',
               filename: emailFilename,
               path: emailPath,
               pageCount: emailPageCount
           });
       }
       
       let currentPageIndex = emailPageCount;
       
       for (const attachment of attachmentInfo) {
           if (currentPageIndex >= totalPages) break;
           
           const attachmentPdf = await PDFDocument.create();
           const endPageIndex = Math.min(currentPageIndex + attachment.pageCount, totalPages);
           const pageIndices = Array.from({ length: endPageIndex - currentPageIndex }, (_, i) => currentPageIndex + i);

           if (pageIndices.length > 0) {
               const attachmentPages = await attachmentPdf.copyPages(mergedPdf, pageIndices);
               attachmentPages.forEach(page => attachmentPdf.addPage(page));

               await this.addAttachmentHeader(attachmentPdf, attachment.originalName);
               await this.addBasicFooter(attachmentPdf);
               const attachmentPdfBuffer = await attachmentPdf.save();
               const attachmentFilename = `demerged_${attachment.originalName}`;
               const attachmentPath = path.join(outputDir, attachmentFilename);

               fs.writeFileSync(attachmentPath, attachmentPdfBuffer);

               results.push({
                   type: 'attachment',
                   filename: attachmentFilename,
                   path: attachmentPath,
                   originalName: attachment.originalName,
                   pageCount: pageIndices.length
               });

               currentPageIndex = endPageIndex;
           }
       }

       return results;
   }

   generateSafeFileName(subject: string, messageId: string, isMerged: boolean = false): string {
       const safeSubject = subject
           .replace(/[<>:"/\\|?*]/g, '_')
           .replace(/\s+/g, '_')
           .substring(0, 50);
       const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
       const suffix = isMerged ? '_merged' : '';
       
       return `${safeSubject}_${timestamp}_${messageId.substring(0, 8)}${suffix}.pdf`;
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