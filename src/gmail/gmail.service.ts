import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from '../auth/auth.service';

interface EmailListResponse {
   emails: Email[];
   nextPageToken?: string;
}

interface Email {
   messageId: string;
   subject: string;
   from: string;
   date: string;
   receiveDate: string;
   snippet: string;
}

interface EmailMessage {
   messageId: string;
   subject: string;
   from: string;
   to: string;
   date: string;
   body: string;
   isHtml: boolean;
   payload: any;
}

@Injectable()
export class GmailService {
   private gmail: any = null;
   private sessionId: string | null = null;

   constructor(private readonly authService: AuthService) {}

   setSessionId(sessionId: string): void {
       this.sessionId = sessionId;
       this.gmail = null;
   }

   private async ensureAuthenticated(sessionId: string): Promise<void> {
       if (sessionId && sessionId !== this.sessionId) {
           this.sessionId = sessionId;
           this.gmail = null;
       }
       if (!this.gmail) {
           if (!this.sessionId) {
               throw new Error('SessionId is required for authentication');
           }
           this.gmail = await this.authService.getGmailClient(this.sessionId);
       }
   }

   async getAuthenticatedUserEmail(sessionId: string): Promise<string> {
       try {
           await this.ensureAuthenticated(sessionId);
           const profile = await this.gmail.users.getProfile({
               userId: 'me'
           });
           return profile.data.emailAddress!;
       } catch (error) {
           console.error('Failed to get authenticated user email:', error);
           throw error;
       }
   }

   async getEmailList(maxResults: number = 10, sessionId: string, pageToken?: string): Promise<EmailListResponse> {
       await this.ensureAuthenticated(sessionId);
       
       const listResponse = await this.gmail.users.messages.list({
           userId: 'me',
           maxResults: parseInt(maxResults.toString()),
           pageToken
       });

       const emails: Email[] = [];
       for (const message of listResponse.data.messages || []) {
           const messageResponse = await this.gmail.users.messages.get({
               userId: 'me',
               id: message.id,
               format: 'metadata',
               metadataHeaders: ['Subject', 'From', 'Date']
           });
           const headers = messageResponse.data.payload.headers;
           emails.push({
               messageId: message.id,
               subject: headers.find(h => h.name === 'Subject')?.value || '',
               from: headers.find(h => h.name === 'From')?.value || '',
               date: headers.find(h => h.name === 'Date')?.value || '',
               receiveDate: messageResponse.data.internalDate ?
                   new Date(parseInt(messageResponse.data.internalDate)).toISOString() : '',
               snippet: messageResponse.data.snippet
           });
       }

       return {
           emails,
           nextPageToken: listResponse.data.nextPageToken
       };
   }

   async getEmailById(messageId: string, sessionId: string): Promise<EmailMessage> {
       await this.ensureAuthenticated(sessionId);
       
       const messageResponse = await this.gmail.users.messages.get({
           userId: 'me',
           id: messageId,
           format: 'full'
       });
       
       return this.parseEmailMessage(messageResponse.data);
   }

   private parseEmailMessage(message: any): EmailMessage {
       const headers = message.payload.headers;
       const subject = headers.find(h => h.name === 'Subject')?.value || '';
       const from = headers.find(h => h.name === 'From')?.value || '';
       const to = headers.find(h => h.name === 'To')?.value || '';
       const date = headers.find(h => h.name === 'Date')?.value || '';
       
       const findPartRecursively = (part: any, mimeType: string): any => {
           if (part.mimeType === mimeType && part.body?.data) return part;
           if (part.parts) {
               for (const subPart of part.parts) {
                   const result = findPartRecursively(subPart, mimeType);
                   if (result) return result;
               }
           }
           return null;
       };

       let body = '';
       let isHtml = false;
       const htmlPart = findPartRecursively(message.payload, 'text/html');
       const textPart = findPartRecursively(message.payload, 'text/plain');

       if (htmlPart) {
           body = Buffer.from(htmlPart.body.data, 'base64').toString('utf8');
           isHtml = true;
       } else if (textPart) {
           body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
       } else if (message.payload.body?.data) {
           body = Buffer.from(message.payload.body.data, 'base64').toString('utf8');
           isHtml = message.payload.mimeType === 'text/html';
       } else {
           body = message.snippet || '';
       }

       return {
           messageId: message.id,
           subject,
           from,
           to,
           date,
           body,
           isHtml,
           payload: message.payload
       };
   }

   async downloadAttachment(messageId: string, attachmentId: string, filename: string, downloadDir: string, sessionId: string): Promise<string> {
       await this.ensureAuthenticated(sessionId);
       
       const attachment = await this.gmail.users.messages.attachments.get({
           userId: 'me',
           messageId,
           id: attachmentId
       });

       const data = Buffer.from(attachment.data.data, 'base64');
       const filePath = path.join(downloadDir, filename);
       fs.writeFileSync(filePath, data);
       
       return filePath;
   }
}