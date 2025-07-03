import { Controller, Get, Post, Delete, Param, Query, Body, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from './attachments.service';

interface AttachmentListResponse {
   messageId: string;
   attachments: any[];
   totalCount: number;
   pdfCount: number;
   hasPdfAttachment: boolean;
}

interface DownloadAttachmentDto {
   filename: string;
   sessionId: string;
}

interface DownloadAllDto {
   pdfOnly?: boolean;
   sessionId: string;
}

interface ApiResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
   message?: string;
}

interface DownloadedFile {
    filename: string;
    filePath: string;
    size: number;
    isPdf: boolean;
}

@Controller('attachments')
export class AttachmentsController {
   constructor(
       private readonly gmailService: GmailService,
       private readonly attachmentsService: AttachmentsService,
   ) {}

   @Get(':messageId/list')
   async getAttachmentsList(
       @Param('messageId') messageId: string,
       @Query('sessionId') sessionId: string
   ): Promise<ApiResponse<AttachmentListResponse>> {
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
                   messageId,
                   attachments,
                   totalCount: attachments.length,
                   pdfCount: attachments.filter(a => a.isPdf).length,
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

   @Post(':messageId/download/:attachmentId')
   async downloadAttachment(
       @Param('messageId') messageId: string,
       @Param('attachmentId') attachmentId: string,
       @Body() body: DownloadAttachmentDto
   ): Promise<ApiResponse> {
       const { filename, sessionId } = body;

       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }
       
       if (!filename) {
           throw new HttpException({
               success: false,
               error: 'Filename is required'
           }, HttpStatus.BAD_REQUEST);
       }

       try {
           const downloadDir = path.join(__dirname, '../downloads/attachments');
           if (!fs.existsSync(downloadDir)) {
               fs.mkdirSync(downloadDir, { recursive: true });
           }

           const filePath = await this.gmailService.downloadAttachment(
               messageId,
               attachmentId,
               filename,
               downloadDir,
               sessionId
           );
           
           return {
               success: true,
               data: {
                   messageId,
                   attachmentId,
                   filename,
                   filePath: path.basename(filePath),
                   size: fs.statSync(filePath).size
               }
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('download/:filename')
   downloadFile(@Param('filename') filename: string, @Res() res: Response): void {
       try {
           const filePath = path.join(__dirname, '../downloads/attachments', filename);
           
           if (!fs.existsSync(filePath)) {
               res.status(404).json({
                   success: false,
                   error: 'File not found'
               });
               return;
           }
           
           const stats = fs.statSync(filePath);
           const mimeType = this.attachmentsService.getMimeType(filename);
           
           res.setHeader('Content-Type', mimeType);
           res.setHeader('Content-Length', stats.size);
           res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
           
           const fileStream = fs.createReadStream(filePath);
           fileStream.pipe(res);
       } catch (error) {
           res.status(500).json({
               success: false,
               error: error.message
           });
       }
   }

   @Post(':messageId/download-all')
   async downloadAllAttachments(
       @Param('messageId') messageId: string,
       @Body() body: DownloadAllDto
   ): Promise<ApiResponse> {
       const { pdfOnly = false, sessionId } = body;
       
       if (!sessionId) {
           throw new HttpException({
               success: false,
               error: 'SessionId is required'
           }, HttpStatus.BAD_REQUEST);
       }

       try {
           const email = await this.gmailService.getEmailById(messageId, sessionId);
           const attachments = this.attachmentsService.detectAttachments(email.payload);
           const filteredAttachments = pdfOnly ? attachments.filter(a => a.isPdf) : attachments;
           
           if (filteredAttachments.length === 0) {
               throw new HttpException({
                   success: false,
                   error: pdfOnly ? 'No PDF attachments found' : 'No attachments found'
               }, HttpStatus.NOT_FOUND);
           }
           
           const downloadDir = path.join(__dirname, '../downloads/attachments');
           if (!fs.existsSync(downloadDir)) {
               fs.mkdirSync(downloadDir, { recursive: true });
           }
           
           const downloadedFiles: DownloadedFile[] = [];
           
           for (const attachment of filteredAttachments) {
               try {
                   const filePath = await this.gmailService.downloadAttachment(
                       messageId,
                       attachment.attachmentId,
                       attachment.filename,
                       downloadDir,
                       sessionId
                   );
                   
                   downloadedFiles.push({
                       filename: attachment.filename,
                       filePath: path.basename(filePath),
                       size: fs.statSync(filePath).size,
                       isPdf: attachment.isPdf
                   });
               } catch (error) {
                   console.error(`Failed to download attachment ${attachment.filename}:`, error.message);
               }
           }
           
           return {
               success: true,
               data: {
                   messageId,
                   downloadedFiles,
                   totalCount: downloadedFiles.length,
                   pdfCount: downloadedFiles.filter(f => f.isPdf).length
               }
           };
       } catch (error) {
           if (error instanceof HttpException) {
               throw error;
           }
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Delete('cleanup/:messageId')
   cleanupAttachments(@Param('messageId') messageId: string): ApiResponse {
       try {
           const attachmentDir = path.join(__dirname, '../downloads/attachments');
           
           if (!fs.existsSync(attachmentDir)) {
               return {
                   success: true,
                   message: 'No files to cleanup'
               };
           }
           
           const files = fs.readdirSync(attachmentDir);
           const deletedFiles: string[] = [];
           
           files.forEach(file => {
               if (file.includes(messageId.substring(0, 8))) {
                   const filePath = path.join(attachmentDir, file);
                   fs.unlinkSync(filePath);
                   deletedFiles.push(file);
               }
           });
           
           return {
               success: true,
               data: {
                   messageId,
                   deletedFiles,
                   deletedCount: deletedFiles.length
               }
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }
}