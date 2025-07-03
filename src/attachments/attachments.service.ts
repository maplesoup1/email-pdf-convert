import { Injectable } from '@nestjs/common';
import * as path from 'path';

interface Attachment {
   filename: string;
   mimeType: string;
   size: number;
   attachmentId: string;
   isPdf: boolean;
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
                       isPdf: this.isPdfFile(part.filename, part.mimeType)
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
               isPdf: this.isPdfFile(payload.filename, payload.mimeType)
           });
       }
       
       if (payload.parts) {
           extractAttachments(payload.parts);
       }
       
       return attachments;
   }

   isPdfFile(filename: string, mimeType: string): boolean {
       const fileExtension = path.extname(filename).toLowerCase();
       if (fileExtension === '.pdf') {
           return true;
       }
       
       if (mimeType === 'application/pdf') {
           return true;
       }
       
       return false;
   }

   hasPdfAttachment(attachments: Attachment[]): boolean {
       return attachments.some(att => att.isPdf);
   }

   getMimeType(filename: string): string {
       const ext = path.extname(filename).toLowerCase();
       const mimeTypes: Record<string, string> = {
           '.pdf': 'application/pdf',
           '.jpg': 'image/jpeg',
           '.jpeg': 'image/jpeg',
           '.png': 'image/png',
           '.gif': 'image/gif',
           '.doc': 'application/msword',
           '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           '.xls': 'application/vnd.ms-excel',
           '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           '.txt': 'text/plain',
           '.zip': 'application/zip'
       };
       return mimeTypes[ext] || 'application/octet-stream';
   }
}
