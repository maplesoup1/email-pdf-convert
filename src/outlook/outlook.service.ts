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
   hasAttachments?: boolean;
}

interface EmailMessage {
   messageId: string;
   threadId: string;
   subject: string;
   from: string;
   to: string;
   date: string;
   body: string;
   isHtml: boolean;
   payload: any;
   attachments?: any[];
}

@Injectable()
export class OutlookService {
   private graphClient: any = null;
   private sessionId: string | null = null;

   constructor(private readonly authService: AuthService) {}

   setSessionId(sessionId: string): void {
       this.sessionId = sessionId;
       this.graphClient = null;
   }

   private async ensureAuthenticated(sessionId: string): Promise<void> {
       if (sessionId && sessionId !== this.sessionId) {
           this.sessionId = sessionId;
           this.graphClient = null;
       }
       if (!this.graphClient) {
           if (!this.sessionId) {
               throw new Error('SessionId is required for authentication');
           }
           this.graphClient = await this.authService.getOutlookClient(this.sessionId);
       }
   }

   async getAuthenticatedUserEmail(sessionId: string): Promise<string> {
       try {
           await this.ensureAuthenticated(sessionId);
           const user = await this.graphClient.api('/me').get();
           return user.mail || user.userPrincipalName;
       } catch (error) {
           console.error('Failed to get authenticated user email:', error);
           throw error;
       }
   }

   async getEmailList(maxResults: number = 10, sessionId: string, pageToken?: string): Promise<EmailListResponse> {
       await this.ensureAuthenticated(sessionId);
       
       let query = this.graphClient.api('/me/messages')
           .top(maxResults)
           .orderby('receivedDateTime desc')
           .select('id,subject,from,receivedDateTime,sentDateTime,bodyPreview,conversationId,hasAttachments');

       let response;
       if (pageToken) {
           response = await this.graphClient.api(pageToken).get();
       } else {
           response = await query.get();
       }
       
       const emails: Email[] = response.value.map((message: any) => ({
           messageId: message.id,
           subject: message.subject || '',
           from: this.extractEmailAddress(message.from),
           date: message.sentDateTime || message.receivedDateTime,
           receiveDate: message.receivedDateTime,
           snippet: message.bodyPreview || '',
           hasAttachments: message.hasAttachments || false
       }));

       const nextPageToken = response['@odata.nextLink'] || undefined;

       return {
           emails,
           nextPageToken
       };
   }

   async getEmailById(messageId: string, sessionId: string): Promise<EmailMessage> {
       await this.ensureAuthenticated(sessionId);
       
       const message = await this.graphClient.api(`/me/messages/${messageId}`)
           .select('id,conversationId,subject,from,toRecipients,sentDateTime,receivedDateTime,body,hasAttachments')
           .expand('attachments')
           .get();
       
       return this.parseEmailMessage(message);
   }

   private parseEmailMessage(message: any): EmailMessage {
       const subject = message.subject || '';
       const from = this.extractEmailAddress(message.from);
       const to = message.toRecipients?.map((recipient: any) => 
           this.extractEmailAddress(recipient)).join(', ') || '';
       const date = message.sentDateTime || message.receivedDateTime;
       
       let body = '';
       let isHtml = false;

       if (message.body) {
           body = message.body.content || '';
           isHtml = message.body.contentType === 'html';
       }

       return {
           messageId: message.id,
           threadId: message.conversationId || message.id,
           subject,
           from,
           to,
           date,
           body,
           isHtml,
           payload: message,
           attachments: message.attachments || []
       };
   }

   private extractEmailAddress(emailObject: any): string {
       if (!emailObject) return '';
       
       if (emailObject.emailAddress) {
           return emailObject.emailAddress.address || emailObject.emailAddress.name || '';
       }
       
       if (typeof emailObject === 'string') {
           return emailObject;
       }
       
       if (emailObject.address) {
           return emailObject.address;
       }
       
       return '';
   }

   async downloadAttachment(messageId: string, attachmentId: string, filename: string, downloadDir: string, sessionId: string): Promise<string> {
       await this.ensureAuthenticated(sessionId);
       
       // Get attachment content from Microsoft Graph
       const attachment = await this.graphClient.api(`/me/messages/${messageId}/attachments/${attachmentId}`)
           .get();

       let data: Buffer;
       
       if (attachment.contentBytes) {
           data = Buffer.from(attachment.contentBytes, 'base64');
       } else if (attachment['@odata.type'] === '#microsoft.graph.itemAttachment') {
           throw new Error('Item attachments are not supported for direct download');
       } else {
           throw new Error('Unknown attachment type');
       }

       const filePath = path.join(downloadDir, filename);
       fs.writeFileSync(filePath, data);
       
       return filePath;
   }

   async getRecentEmails(sessionId: string, maxResults: number = 50): Promise<EmailListResponse> {
       await this.ensureAuthenticated(sessionId);
       
       const twentyFourHoursAgo = new Date();
       twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
       const afterDate = twentyFourHoursAgo.toISOString();
       
       const response = await this.graphClient.api('/me/messages')
           .top(maxResults)
           .orderby('receivedDateTime desc')
           .filter(`receivedDateTime ge ${afterDate}`)
           .select('id,subject,from,receivedDateTime,sentDateTime,bodyPreview,conversationId,hasAttachments')
           .get();

       const emails: Email[] = response.value
           .filter((message: any) => {
               const receivedDate = new Date(message.receivedDateTime);
               return receivedDate >= twentyFourHoursAgo;
           })
           .map((message: any) => ({
               messageId: message.id,
               subject: message.subject || '',
               from: this.extractEmailAddress(message.from),
               date: message.sentDateTime || message.receivedDateTime,
               receiveDate: message.receivedDateTime,
               snippet: message.bodyPreview || '',
               hasAttachments: message.hasAttachments || false
           }));

       const nextPageToken = response['@odata.nextLink'] || undefined;

       return {
           emails,
           nextPageToken
       };
   }

   async getEmailAttachments(messageId: string, sessionId: string): Promise<any[]> {
       await this.ensureAuthenticated(sessionId);
       
       try {
           const response = await this.graphClient.api(`/me/messages/${messageId}/attachments`)
               .get();
           
           return response.value || [];
       } catch (error) {
           console.error(`Failed to get attachments for message ${messageId}:`, error);
           return [];
       }
   }

   async hasAttachments(messageId: string, sessionId: string): Promise<boolean> {
       await this.ensureAuthenticated(sessionId);
       
       try {
           const message = await this.graphClient.api(`/me/messages/${messageId}`)
               .select('hasAttachments')
               .get();
           
           return message.hasAttachments || false;
       } catch (error) {
           console.error(`Failed to check attachments for message ${messageId}:`, error);
           return false;
       }
   }
   
}