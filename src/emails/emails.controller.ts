import { Controller, Get, Post, Param, Query, Body, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { EmailsService } from './emails.service';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthService } from '../auth/auth.service';
import { PdfProcessingOption } from '../pdf/pdf.service';

interface ConvertEmailDto {
   sessionId: string;
   outputDir?: string;
   processingOption?: PdfProcessingOption;
}

interface EmailListResponse {
   emails: any[];
   nextPageToken?: string;
   sessionId: string;
}

interface EmailDetailResponse {
   messageId: string;
   subject: string;
   from: string;
   to: string;
   date: string;
   body: string;
   isHtml: boolean;
   payload: any;
   attachments: any[];
   hasPdfAttachment: boolean;
}

interface ConvertEmailResponse {
   messageId: string;
   subject: string;
   pdfPaths: string[];
   processingOption: PdfProcessingOption;
   merged: boolean;
   attachmentCount: number;
   pdfAttachmentCount: number;
   sessionId: string;
}

interface ApiResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
}

@Controller('emails')
export class EmailsController {
   constructor(
       private readonly emailsService: EmailsService,
       private readonly gmailService: GmailService,
       private readonly attachmentsService: AttachmentsService,
       private readonly authService: AuthService,
   ) {}

   private validateSessionId(sessionId?: string): void {
       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }
   }

   private createResponse<T>(success: boolean, data?: T, error?: string): ApiResponse<T> {
       return {
           success,
           ...(data && { data }),
           ...(error && { error })
       };
   }

   private async validateMessageAccess(sessionId: string, messageId: string): Promise<void> {
       const gmail = await this.authService.getGmailClient(sessionId);
       try {
           await gmail.users.messages.get({ userId: 'me', id: messageId });
       } catch {
           throw new Error('Invalid messageId for this session. Possibly from a different Gmail account.');
       }
   }

   private async validateMultipleMessageAccess(sessionId: string, messageIds: string[]): Promise<void> {
       const gmail = await this.authService.getGmailClient(sessionId);
       for (const id of messageIds) {
           try {
               await gmail.users.messages.get({ userId: 'me', id });
           } catch {
               throw new Error(`Invalid messageId ${id}. Possibly not accessible for this session.`);
           }
       }
   }

   @Get('list')
   async getEmailList(
       @Query('maxResults') maxResults: number = 20,
       @Query('sessionId') sessionId: string,
       @Query('pageToken') pageToken?: string
   ): Promise<ApiResponse<EmailListResponse>> {
       this.validateSessionId(sessionId);

       try {
           const emailData = await this.gmailService.getEmailList(maxResults, sessionId, pageToken);
           
           return this.createResponse(true, {
               ...emailData,
               sessionId
           });
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Get(':messageId')
   async getEmailDetail(
       @Param('messageId') messageId: string,
       @Query('sessionId') sessionId: string
   ): Promise<ApiResponse<EmailDetailResponse>> {
       this.validateSessionId(sessionId);

       try {
           const email = await this.gmailService.getEmailById(messageId, sessionId);
           const attachments = this.attachmentsService.detectAttachments(email.payload);
           
           return this.createResponse(true, {
               ...email,
               attachments,
               hasPdfAttachment: this.attachmentsService.hasPdfAttachment(attachments)
           });
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Post('convert/:messageId')
   async convertEmail(
       @Param('messageId') messageId: string,
       @Body() body: ConvertEmailDto
   ): Promise<ApiResponse<ConvertEmailResponse>> {
       const { sessionId, outputDir, processingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS } = body;
       this.validateSessionId(sessionId);

       try {
           await this.validateMessageAccess(sessionId, messageId);
           this.emailsService.setSessionId(sessionId);
           const result = await this.emailsService.processEmail(messageId, processingOption, outputDir);

           return this.createResponse(true, {
               messageId: result.messageId,
               subject: result.subject,
               pdfPaths: result.pdfPaths,
               processingOption: result.processingOption,
               merged: result.merged,
               attachmentCount: result.attachments.length,
               pdfAttachmentCount: result.attachments.filter(a => a.isPdf).length,
               sessionId
           });
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Get(':messageId/download/:attachmentId')
   async downloadAttachment(
       @Param('messageId') messageId: string,
       @Param('attachmentId') attachmentId: string,
       @Query('sessionId') sessionId: string,
       @Query('filename') filename: string,
       @Res() res: Response
   ): Promise<void> {
       if (!sessionId) {
           res.status(400).json(this.createResponse(false, undefined, 'SessionId is required'));
           return;
       }

       try {
           const tempDir = path.join(__dirname, '../temp');
           if (!fs.existsSync(tempDir)) {
               fs.mkdirSync(tempDir, { recursive: true });
           }

           const filePath = await this.gmailService.downloadAttachment(
               messageId,
               attachmentId,
               filename,
               tempDir,
               sessionId
           );

           res.download(filePath, filename, (err) => {
               if (err) {
                   console.error('Download error:', err);
                   if (!res.headersSent) {
                       res.status(500).json(this.createResponse(false, undefined, 'Download failed'));
                   }
               }
               
               if (fs.existsSync(filePath)) {
                   fs.unlinkSync(filePath);
               }
           });
       } catch (error) {
           res.status(500).json(this.createResponse(false, undefined, error.message));
       }
   }

   @Post('convert-multiple')
   async convertMultipleEmails(
       @Body() body: { 
           sessionId: string; 
           messageIds: string[]; 
           outputDir?: string;
           processingOption?: PdfProcessingOption;
       }
   ): Promise<ApiResponse<ConvertEmailResponse[]>> {
       const { sessionId, messageIds, outputDir, processingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS } = body;

       if (!sessionId || !Array.isArray(messageIds) || messageIds.length === 0) {
           throw new HttpException(
               this.createResponse(false, undefined, 'SessionId and messageIds are required'),
               HttpStatus.BAD_REQUEST
           );
       }

       try {
           await this.validateMultipleMessageAccess(sessionId, messageIds);
           this.emailsService.setSessionId(sessionId);
           const results = await this.emailsService.processMultipleEmails(messageIds, processingOption, outputDir);
           
           const responseData: ConvertEmailResponse[] = results.map((r) => ({
               messageId: r.messageId,
               subject: r.subject,
               pdfPaths: r.pdfPaths,
               processingOption: r.processingOption,
               merged: r.merged,
               attachmentCount: r.attachments.length,
               pdfAttachmentCount: r.attachments.filter((a) => a.isPdf).length,
               sessionId,
           }));

           return this.createResponse(true, responseData);
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Post('auto-process')
   async autoProcessEmails(
       @Body() body: { 
           sessionId?: string; 
           maxEmails?: number; 
           outputDir?: string;
           processingOption?: PdfProcessingOption;
       }
   ): Promise<ApiResponse<any>> {
       const { sessionId, maxEmails = 10, outputDir, processingOption = PdfProcessingOption.MERGE_WITH_ATTACHMENTS } = body;
       
       try {
           if (!sessionId) {
               const newSessionId = this.authService.generateSessionId();
               const authUrl = this.authService.generateAuthUrl(newSessionId);
               
               return this.createResponse(true, {
                   authUrl,
                   sessionId: newSessionId,
                   message: 'Please complete authentication at the provided URL, then call this endpoint again with the sessionId',
                   step: 'auth_required'
               });
           }
           
           try {
               await this.authService.getGmailClient(sessionId);
           } catch (error) {
               const authUrl = this.authService.generateAuthUrl(sessionId);
               return this.createResponse(false, {
                   authUrl,
                   sessionId,
                   message: 'Session expired or invalid. Please authenticate again.',
                   step: 'auth_required'
               });
           }
           
           const result = await this.emailsService.autoProcessAllEmails(sessionId, maxEmails, processingOption, outputDir);
           
           return this.createResponse(result.success, {
               ...result,
               sessionId,
               step: 'completed'
           });
           
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Get('processing-options')
   async getProcessingOptions(): Promise<ApiResponse<{ options: PdfProcessingOption[]; descriptions: Record<string, string> }>> {
       return this.createResponse(true, {
           options: Object.values(PdfProcessingOption),
           descriptions: {
               [PdfProcessingOption.MERGE_WITH_ATTACHMENTS]: 'Merge email body with PDF attachments into one file',
               [PdfProcessingOption.EMAIL_BODY_ONLY]: 'Generate PDF from email body only',
               [PdfProcessingOption.SEPARATE_EMAIL_AND_ATTACHMENTS]: 'Generate separate PDFs for email and each attachment',
               [PdfProcessingOption.ATTACHMENTS_ONLY]: 'Generate PDFs from attachments only, skip email body'
           }
       });
   }

   @Get(':messageId/page-count')
   async getEmailPageCount(
       @Param('messageId') messageId: string,
       @Query('sessionId') sessionId: string
   ): Promise<ApiResponse<{ pageCount: number }>> {
       this.validateSessionId(sessionId);

       try {
           this.emailsService.setSessionId(sessionId);
           const pageCount = await this.emailsService.getEmailPageCount(messageId);
           return this.createResponse(true, { pageCount });
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }
}