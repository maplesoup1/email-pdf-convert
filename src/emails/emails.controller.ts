import { Controller, Get, Post, Param, Query, Body, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { EmailsService } from './emails.service';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthService } from '../auth/auth.service';

interface ConvertEmailDto {
   sessionId: string;
   outputDir?: string;
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
   pdfPath: string;
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

   @Get('list')
   async getEmailList(
       @Query('maxResults') maxResults: number = 20,
       @Query('sessionId') sessionId: string,
       @Query('pageToken') pageToken?: string
   ): Promise<ApiResponse<EmailListResponse>> {
       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }

       try {
           const emailData = await this.gmailService.getEmailList(maxResults, sessionId, pageToken);
           
           return {
               success: true,
               data: {
                   ...emailData,
                   sessionId
               }
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get(':messageId')
   async getEmailDetail(
       @Param('messageId') messageId: string,
       @Query('sessionId') sessionId: string
   ): Promise<ApiResponse<EmailDetailResponse>> {
       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }

       try {
           const email = await this.gmailService.getEmailById(messageId, sessionId);
           const attachments = this.attachmentsService.detectAttachments(email.payload);
           
           return {
               success: true,
               data: {
                   ...email,
                   attachments,
                   hasPdfAttachment: this.attachmentsService.hasPdfAttachment(attachments)
               }
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Post('convert/:messageId')
   async convertEmail(
       @Param('messageId') messageId: string,
       @Body() body: ConvertEmailDto
   ): Promise<ApiResponse<ConvertEmailResponse>> {
       const { sessionId, outputDir } = body;

       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }

       try {
           const gmail = await this.authService.getGmailClient(sessionId);
           try {
               await gmail.users.messages.get({ userId: 'me', id: messageId });
           } catch {
               throw new Error('Invalid messageId for this session. Possibly from a different Gmail account.');
           }

           this.emailsService.setSessionId(sessionId);
           const result = await this.emailsService.processEmail(messageId, outputDir);

           return {
               success: true,
               data: {
                   messageId: result.messageId,
                   subject: result.subject,
                   pdfPath: result.pdfPath,
                   merged: result.merged,
                   attachmentCount: result.attachments.length,
                   pdfAttachmentCount: result.attachments.filter(a => a.isPdf).length,
                   sessionId
               }
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
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
           res.status(400).json({
               success: false,
               error: 'SessionId is required'
           });
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
                       res.status(500).json({ success: false, error: 'Download failed' });
                   }
               }
               
               if (fs.existsSync(filePath)) {
                   fs.unlinkSync(filePath);
               }
           });
       } catch (error) {
           res.status(500).json({
               success: false,
               error: error.message
           });
       }
   }

   @Post('convert-multiple')
    async convertMultipleEmails(
    @Body() body: { sessionId: string; messageIds: string[]; outputDir?: string }
    ): Promise<ApiResponse<ConvertEmailResponse[]>> {
    const { sessionId, messageIds, outputDir } = body;

    if (!sessionId || !Array.isArray(messageIds) || messageIds.length === 0) {
        throw new HttpException(
        { success: false, error: 'SessionId and messageIds are required' },
        HttpStatus.BAD_REQUEST
        );
    }

    try {
        const gmail = await this.authService.getGmailClient(sessionId);
        for (const id of messageIds) {
        try {
            await gmail.users.messages.get({ userId: 'me', id });
        } catch {
            throw new Error(`Invalid messageId ${id}. Possibly not accessible for this session.`);
        }
        }
        this.emailsService.setSessionId(sessionId);
        const results = await this.emailsService.processMultipleEmails(messageIds, outputDir);
        const responseData: ConvertEmailResponse[] = results.map((r) => ({
        messageId: r.messageId,
        subject: r.subject,
        pdfPath: r.pdfPath,
        merged: r.merged,
        attachmentCount: r.attachments.length,
        pdfAttachmentCount: r.attachments.filter((a) => a.isPdf).length,
        sessionId,
        }));

        return {
        success: true,
        data: responseData,
        };
    } catch (error) {
        throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
    }

}