import { Injectable } from '@nestjs/common';
import * as path from 'path';

interface Attachment {
   filename: string;
   mimeType: string;
   size: number;
   attachmentId: string;
   isPdf: boolean;
   isInline?: boolean;
   contentType?: string;
   originalData?: any;
}

@Injectable()
export class AttachmentsService {
   detectAttachments(payload: any): Attachment[] {
       const attachments: Attachment[] = [];
       
       const extractAttachments = (parts: any[]): void => {
           if (!parts) return;
           for (const part of parts) {
               if (part.filename && part.filename.length > 0) {
                   const attachment: Attachment = {
                       filename: part.filename,
                       mimeType: part.mimeType,
                       size: part.body.size || 0,
                       attachmentId: part.body.attachmentId,
                       isPdf: this.isPdfFile(part.filename, part.mimeType),
                       isInline: part.headers && part.headers.some(h => h.name.toLowerCase() === 'content-disposition' && h.value.includes('inline'))
                   };
                   attachments.push(attachment);
               }
               
               if (part.parts) {
                   extractAttachments(part.parts);
               }
           }
       };

       if (payload.filename && payload.filename.length > 0) {
           attachments.push({
               filename: payload.filename,
               mimeType: payload.mimeType,
               size: payload.body.size || 0,
               attachmentId: payload.body.attachmentId,
               isPdf: this.isPdfFile(payload.filename, payload.mimeType),
               isInline: false
           });
       }
       
       if (payload.parts) {
           extractAttachments(payload.parts);
       }
       
       return attachments;
   }

   formatOutlookAttachments(outlookAttachments: any[]): Attachment[] {
       if (!outlookAttachments || !Array.isArray(outlookAttachments)) {
           return [];
       }

       return outlookAttachments.map(attachment => {
           const mimeType = attachment.contentType || attachment['@odata.mediaContentType'] || 'application/octet-stream';
           const isPdf = this.isPdfFile(attachment.name || '', mimeType);
           
           return {
               attachmentId: attachment.id,
               filename: attachment.name || 'unnamed',
               mimeType: mimeType,
               size: attachment.size || 0,
               isPdf: isPdf,
               isInline: attachment.isInline || false,
               contentType: attachment.contentType,
               originalData: attachment
           };
       });
   }

   isPdfFile(filename: string, mimeType: string): boolean {
       if (!filename && !mimeType) return false;
       
       if (filename) {
           const fileExtension = path.extname(filename).toLowerCase();
           if (fileExtension === '.pdf') {
               return true;
           }
           
           const extension = filename.toLowerCase().split('.').pop();
           if (extension === 'pdf') {
               return true;
           }
       }
       
       if (mimeType && mimeType.toLowerCase() === 'application/pdf') {
           return true;
       }
       
       return false;
   }

   hasPdfAttachment(attachments: Attachment[]): boolean {
       return attachments.some(att => att.isPdf);
   }

   getPdfAttachments(attachments: Attachment[]): Attachment[] {
       return attachments.filter(att => att.isPdf);
   }

   getNonPdfAttachments(attachments: Attachment[]): Attachment[] {
       return attachments.filter(att => !att.isPdf);
   }

   getAttachmentsByMimeType(attachments: Attachment[], mimeType: string): Attachment[] {
       return attachments.filter(att => att.mimeType === mimeType);
   }

   getTotalAttachmentSize(attachments: Attachment[]): number {
       return attachments.reduce((total, att) => total + (att.size || 0), 0);
   }

   getMimeType(filename: string): string {
       if (!filename) return 'application/octet-stream';
       
       const ext = path.extname(filename).toLowerCase();
       const mimeTypes: Record<string, string> = {
           '.pdf': 'application/pdf',
           '.jpg': 'image/jpeg',
           '.jpeg': 'image/jpeg',
           '.png': 'image/png',
           '.gif': 'image/gif',
           '.bmp': 'image/bmp',
           '.webp': 'image/webp',
           '.svg': 'image/svg+xml',
           '.ico': 'image/x-icon',
           '.doc': 'application/msword',
           '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           '.xls': 'application/vnd.ms-excel',
           '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           '.ppt': 'application/vnd.ms-powerpoint',
           '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
           '.txt': 'text/plain',
           '.csv': 'text/csv',
           '.html': 'text/html',
           '.xml': 'text/xml',
           '.json': 'application/json',
           '.zip': 'application/zip',
           '.rar': 'application/x-rar-compressed',
           '.7z': 'application/x-7z-compressed',
           '.tar': 'application/x-tar',
           '.gz': 'application/gzip',
           '.mp3': 'audio/mpeg',
           '.wav': 'audio/wav',
           '.ogg': 'audio/ogg',
           '.mp4': 'video/mp4',
           '.avi': 'video/x-msvideo',
           '.mov': 'video/quicktime',
           '.wmv': 'video/x-ms-wmv',
           '.flv': 'video/x-flv'
       };
       return mimeTypes[ext] || 'application/octet-stream';
   }

   sanitizeFilename(filename: string): string {
       if (!filename) return 'unnamed';
       
       return filename
           .replace(/[<>:"/\\|?*]/g, '_')
           .replace(/\s+/g, '_')
           .replace(/[^\x20-\x7E]/g, '')
           .substring(0, 100);
   }

   isImageAttachment(attachment: Attachment): boolean {
       return attachment.mimeType.startsWith('image/');
   }

   isDocumentAttachment(attachment: Attachment): boolean {
       const documentMimeTypes = [
           'application/pdf',
           'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.ms-powerpoint',
           'application/vnd.openxmlformats-officedocument.presentationml.presentation',
           'text/plain',
           'text/csv'
       ];
       return documentMimeTypes.includes(attachment.mimeType);
   }

   isArchiveAttachment(attachment: Attachment): boolean {
       const archiveMimeTypes = [
           'application/zip',
           'application/x-rar-compressed',
           'application/x-7z-compressed',
           'application/x-tar',
           'application/gzip'
       ];
       return archiveMimeTypes.includes(attachment.mimeType);
   }

   getAttachmentCategory(attachment: Attachment): string {
       if (this.isPdfFile(attachment.filename, attachment.mimeType)) {
           return 'pdf';
       }
       if (this.isImageAttachment(attachment)) {
           return 'image';
       }
       if (this.isDocumentAttachment(attachment)) {
           return 'document';
       }
       if (this.isArchiveAttachment(attachment)) {
           return 'archive';
       }
       if (attachment.mimeType.startsWith('audio/')) {
           return 'audio';
       }
       if (attachment.mimeType.startsWith('video/')) {
           return 'video';
       }
       return 'other';
   }

   groupAttachmentsByCategory(attachments: Attachment[]): Record<string, Attachment[]> {
       const groups: Record<string, Attachment[]> = {};
       
       for (const attachment of attachments) {
           const category = this.getAttachmentCategory(attachment);
           if (!groups[category]) {
               groups[category] = [];
           }
           groups[category].push(attachment);
       }
       
       return groups;
   }

   validateAttachment(attachment: Attachment): boolean {
       return !!(attachment.filename && attachment.attachmentId && attachment.mimeType);
   }

   filterValidAttachments(attachments: Attachment[]): Attachment[] {
       return attachments.filter(att => this.validateAttachment(att));
   }
}