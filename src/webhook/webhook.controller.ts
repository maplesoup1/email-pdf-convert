import { Controller, Post, Get, Body, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { EmailsService } from '../emails/emails.service';
import { PdfRule } from '../emails/emails.entity';
import { WebhookService } from './webhook.service';

interface ApiResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
}

@Controller('webhooks')
export class WebhookController {
   constructor(
       private readonly emailsService: EmailsService,
       private readonly webhookService: WebhookService,
   ) {}

   private createResponse<T>(success: boolean, data?: T, error?: string): ApiResponse<T> {
       return {
           success,
           ...(data && { data }),
           ...(error && { error })
       };
   }

   @Get('outlook')
   async validateOutlookWebhook(
       @Res() res: Response,
       @Query('validationToken') validationToken: string
   ): Promise<void> {
       if (validationToken) {
           res.setHeader('Content-Type', 'text/plain');
           res.status(200).send(validationToken);
           return;
       }
       res.status(400).send('Missing validationToken');
   }

   @Post('outlook')
   async handleOutlookNotification(
       @Res() res: Response,
       @Body() body: any,
       @Query('validationToken') validationToken?: string,
       @Query('sessionId') sessionId?: string,
       @Query('pdfRule') pdfRule?: PdfRule,
       @Query('outputDir') outputDir?: string,
       @Query('notifyUrl') notifyUrl?: string
   ): Promise<void> {
    console.log('✅ Webhook received:', JSON.stringify(body, null, 2));
    console.log('🔧 sessionId:', sessionId, 'pdfRule:', pdfRule);
       try {
           if (validationToken) {
               res.setHeader('Content-Type', 'text/plain');
               res.status(200).send(validationToken);
               return;
           }

           if (!body || !Array.isArray(body.value)) {
               res.status(400).json({ success: false, error: 'Invalid webhook payload' });
               return;
           }

           if (!sessionId) {
               res.status(400).json({ success: false, error: 'SessionId is required' });
               return;
           }

           const result = await this.webhookService.processOutlookNotification(
               body.value,
               sessionId,
               pdfRule || PdfRule.MAIN_BODY_WITH_ATTACHMENT,
               outputDir,
               notifyUrl
           );

           res.status(200).json({ success: true, data: result });
       } catch (err) {
           res.status(500).json({ success: false, error: err.message });
       }
   }

   @Get('validation')
   @Post('validation')
   async validateWebhook(
       @Res() res: Response,
       @Body() body?: any,
       @Query('validationToken') validationToken?: string
   ): Promise<void> {
       if (validationToken) {
           res.setHeader('Content-Type', 'text/plain');
           res.status(200).send(validationToken);
           return;
       }

       if (body && body.challenge) {
           res.status(200).send(body.challenge);
           return;
       }

       res.status(400).send('Invalid validation request');
   }

   @Get('test')
   async testEndpoint(): Promise<{ message: string }> {
       return { message: 'Webhook endpoint is working!' };
   }
}