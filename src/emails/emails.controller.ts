import { Controller, Get, Post, Param, Query, Body, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { EmailsService, EmailProvider } from './emails.service';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuthService } from '../auth/auth.service';
import { PdfRule } from './emails.entity';

interface WebhookStatusResponse {
   isActive: boolean;
   subscriptionId?: string;
   webhookUrl?: string;
   lastActivity?: string;
   pdfRule?: PdfRule;
   outputDir?: string;
   notifyUrl?: string;
   expirationDateTime?: string;
}

interface ConvertEmailDto {
   sessionId: string;
   provider: EmailProvider;
   outputDir?: string;
   pdfRule?: PdfRule;
}

interface EmailListResponse {
   emails: any[];
   nextPageToken?: string;
   sessionId: string;
   provider: EmailProvider;
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
   provider: EmailProvider;
}

interface ConvertEmailResponse {
   messageId: string;
   subject: string;
   pdfUrls: string[];
   pdfRule: PdfRule;
   merged: boolean;
   attachmentCount: number;
   pdfAttachmentCount: number;
   sessionId: string;
   provider: EmailProvider;
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
       private readonly outlookService: OutlookService,
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

   @Post('subscribe')
   async subscribeToOutlookWebhook(
       @Query('sessionId') sessionId: string,
       @Query('ngrokUrl') ngrokUrl: string,
       @Query('autoConvert') autoConvert?: string,
       @Query('pdfRule') pdfRule?: PdfRule,
       @Query('outputDir') outputDir?: string,
       @Query('notifyUrl') notifyUrl?: string
   ): Promise<ApiResponse<any>> {
       this.validateSessionId(sessionId);
   
       try {
           const token = await this.authService.getOutlookAccessToken(sessionId);
   
           const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
           
           let webhookUrl = `${ngrokUrl}/api/webhooks/outlook?sessionId=${sessionId}`;
           
           if (autoConvert === 'true' || autoConvert === '1') {
               webhookUrl += '&autoConvert=true';
               
               if (pdfRule) {
                   webhookUrl += `&pdfRule=${pdfRule}`;
               }
               
               if (outputDir) {
                   webhookUrl += `&outputDir=${encodeURIComponent(outputDir)}`;
               }
               
               if (notifyUrl) {
                   webhookUrl += `&notifyUrl=${encodeURIComponent(notifyUrl)}`;
               }
           }
           
           const subscriptionPayload = {
               changeType: 'created',
               notificationUrl: webhookUrl,
               resource: "me/mailFolders('Inbox')/messages",
               expirationDateTime: expiration.toISOString(),
               clientState: 'secure-state-123'
           };
   
           const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
               method: 'POST',
               headers: {
                   'Authorization': `Bearer ${token}`,
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify(subscriptionPayload)
           });
   
           const data = await response.json();
   
           if (!response.ok) {
               return this.createResponse(false, undefined, `Graph API Error: ${data.error?.message || response.statusText}`);
           }
   
           const subscriptionInfo = {
               subscriptionId: data.id,
               expirationDateTime: data.expirationDateTime,
               resource: data.resource,
               webhookUrl,
               autoConvert: autoConvert === 'true' || autoConvert === '1',
               pdfRule: pdfRule || PdfRule.MAIN_BODY_WITH_ATTACHMENT,
               outputDir: outputDir || 'default',
               notifyUrl: notifyUrl || 'none',
               createdAt: new Date().toISOString()
           };
           
           const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
           fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionInfo, null, 2));
           
           return this.createResponse(true, {
               subscriptionId: data.id,
               expirationDateTime: data.expirationDateTime,
               resource: data.resource,
               webhookUrl,
               autoConvert: autoConvert === 'true' || autoConvert === '1',
               config: {
                   pdfRule: pdfRule || PdfRule.MAIN_BODY_WITH_ATTACHMENT,
                   outputDir: outputDir || 'default',
                   notifyUrl: notifyUrl || 'none'
               }
           });
       } catch (error) {
           return this.createResponse(false, undefined, error.message);
       }
   }

   private validateProvider(provider?: EmailProvider): void {
       if (!provider || !Object.values(EmailProvider).includes(provider)) {
           throw new HttpException({
               success: false,
               error: 'Valid provider (gmail/outlook) is required'
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

   private async validateMessageAccess(sessionId: string, messageId: string, provider: EmailProvider): Promise<void> {
       try {
           if (provider === EmailProvider.GMAIL) {
               const gmail = await this.authService.getGmailClient(sessionId);
               await gmail.users.messages.get({ userId: 'me', id: messageId });
           } else if (provider === EmailProvider.OUTLOOK) {
               const outlookClient = await this.authService.getOutlookClient(sessionId);
               await outlookClient.api(`/me/messages/${messageId}`).get();
           }
       } catch {
           throw new Error(`Invalid messageId for this session. Possibly from a different ${provider} account.`);
       }
   }

   private async validateMultipleMessageAccess(sessionId: string, messageIds: string[], provider: EmailProvider): Promise<void> {
       for (const id of messageIds) {
           await this.validateMessageAccess(sessionId, id, provider);
       }
   }

   @Get('list')
   async getEmailList(
       @Query('maxResults') maxResults: number = 20,
       @Query('sessionId') sessionId: string,
       @Query('provider') provider: EmailProvider,
       @Query('pageToken') pageToken?: string
   ): Promise<ApiResponse<EmailListResponse>> {
       this.validateSessionId(sessionId);
       this.validateProvider(provider);

       try {
           let emailData;
           if (provider === EmailProvider.GMAIL) {
               emailData = await this.gmailService.getEmailList(maxResults, sessionId, pageToken);
           } else if (provider === EmailProvider.OUTLOOK) {
               emailData = await this.outlookService.getEmailList(maxResults, sessionId, pageToken);
           }
           
           return this.createResponse(true, {
               ...emailData,
               sessionId,
               provider
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
       @Query('sessionId') sessionId: string,
       @Query('provider') provider: EmailProvider
   ): Promise<ApiResponse<EmailDetailResponse>> {
       this.validateSessionId(sessionId);
       this.validateProvider(provider);

       try {
           let email;
           let attachments: any[] = [];
           
           if (provider === EmailProvider.GMAIL) {
               email = await this.gmailService.getEmailById(messageId, sessionId);
               attachments = this.attachmentsService.detectAttachments(email.payload);
           } else if (provider === EmailProvider.OUTLOOK) {
               email = await this.outlookService.getEmailById(messageId, sessionId);
               
               console.log('=== Outlook Email Debug ===');
               console.log('Email attachments from expand:', email.attachments?.length || 0);
               
               if (email.attachments && email.attachments.length > 0) {
                   attachments = this.attachmentsService.formatOutlookAttachments(email.attachments);
                   console.log('Formatted attachments:', attachments.length);
               } else {
                   try {
                       console.log('Fetching attachments separately...');
                       const outlookAttachments = await this.outlookService.getEmailAttachments(messageId, sessionId);
                       console.log('Separate attachments fetch result:', outlookAttachments.length);
                       attachments = this.attachmentsService.formatOutlookAttachments(outlookAttachments);
                   } catch (attachmentError) {
                       console.warn(`Failed to get Outlook attachments for ${messageId}:`, attachmentError);
                       attachments = [];
                   }
               }
               
               console.log('Final attachments:', attachments.map(a => ({ 
                   filename: a.filename, 
                   mimeType: a.mimeType, 
                   isPdf: a.isPdf 
               })));
           }
           
           return this.createResponse(true, {
               ...email,
               attachments,
               hasPdfAttachment: this.attachmentsService.hasPdfAttachment(attachments),
               provider
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
       const { sessionId, provider, outputDir, pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT } = body;
       this.validateSessionId(sessionId);
       this.validateProvider(provider);

       try {
           await this.validateMessageAccess(sessionId, messageId, provider);
           await this.emailsService.setSessionId(sessionId, provider);
           const result = await this.emailsService.processEmail(messageId, pdfRule, outputDir, provider);

           return this.createResponse(true, {
               messageId: result.messageId,
               subject: result.subject,
               pdfUrls: result.pdfUrls,
               pdfRule: result.pdfRule,
               merged: result.merged,
               attachmentCount: result.attachments.length,
               pdfAttachmentCount: result.attachments.filter(a => a.isPdf).length,
               sessionId,
               provider
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
       @Query('provider') provider: EmailProvider,
       @Query('filename') filename: string,
       @Res() res: Response
   ): Promise<void> {
       if (!sessionId) {
           res.status(400).json(this.createResponse(false, undefined, 'SessionId is required'));
           return;
       }

       if (!provider) {
           res.status(400).json(this.createResponse(false, undefined, 'Provider is required'));
           return;
       }

       try {
           const tempDir = path.join(__dirname, '../temp');
           if (!fs.existsSync(tempDir)) {
               fs.mkdirSync(tempDir, { recursive: true });
           }

           let filePath: string;
           if (provider === EmailProvider.GMAIL) {
               filePath = await this.gmailService.downloadAttachment(
                   messageId,
                   attachmentId,
                   filename,
                   tempDir,
                   sessionId
               );
           } else if (provider === EmailProvider.OUTLOOK) {
               filePath = await this.outlookService.downloadAttachment(
                   messageId,
                   attachmentId,
                   filename,
                   tempDir,
                   sessionId
               );
           } else {
               res.status(400).json(this.createResponse(false, undefined, 'Invalid provider'));
               return;
           }

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
           provider: EmailProvider;
           messageIds: string[]; 
           outputDir?: string;
           pdfRule?: PdfRule;
       }
   ): Promise<ApiResponse<ConvertEmailResponse[]>> {
       const { sessionId, provider, messageIds, outputDir, pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT } = body;

       if (!sessionId || !provider || !Array.isArray(messageIds) || messageIds.length === 0) {
           throw new HttpException(
               this.createResponse(false, undefined, 'SessionId, provider, and messageIds are required'),
               HttpStatus.BAD_REQUEST
           );
       }

       this.validateProvider(provider);

       try {
           await this.validateMultipleMessageAccess(sessionId, messageIds, provider);
           await this.emailsService.setSessionId(sessionId, provider);
           const results = await this.emailsService.processMultipleEmails(messageIds, pdfRule, outputDir, provider);
           
           const responseData: ConvertEmailResponse[] = results.map((r) => ({
               messageId: r.messageId,
               subject: r.subject,
               pdfUrls: r.pdfUrls,
               pdfRule: r.pdfRule,
               merged: r.merged,
               attachmentCount: r.attachments.length,
               pdfAttachmentCount: r.attachments.filter((a) => a.isPdf).length,
               sessionId,
               provider
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
           provider: EmailProvider;
           maxEmails?: number; 
           outputDir?: string;
           pdfRule?: PdfRule;
       }
   ): Promise<ApiResponse<any>> {
       const { sessionId, provider, maxEmails = 10, outputDir, pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT } = body;
       
       this.validateProvider(provider);
       
       try {
           if (!sessionId) {
               const newSessionId = this.authService.generateSessionId();
               let authUrl: string = '';
               
               if (provider === EmailProvider.GMAIL) {
                   authUrl = this.authService.generateAuthUrl(newSessionId);
               } else if (provider === EmailProvider.OUTLOOK) {
                   authUrl = this.authService.generateOutlookAuthUrl(newSessionId);
               }
               
               return this.createResponse(true, {
                   authUrl,
                   sessionId: newSessionId,
                   provider,
                   message: 'Please complete authentication at the provided URL, then call this endpoint again with the sessionId',
                   step: 'auth_required'
               });
           }
           
           try {
               if (provider === EmailProvider.GMAIL) {
                   await this.authService.getGmailClient(sessionId);
               } else if (provider === EmailProvider.OUTLOOK) {
                   await this.authService.getOutlookClient(sessionId);
               }
           } catch (error) {
               let authUrl: string = '';
               if (provider === EmailProvider.GMAIL) {
                   authUrl = this.authService.generateAuthUrl(sessionId);
               } else if (provider === EmailProvider.OUTLOOK) {
                   authUrl = this.authService.generateOutlookAuthUrl(sessionId);
               }
               
               return this.createResponse(false, {
                   authUrl,
                   sessionId,
                   provider,
                   message: 'Session expired or invalid. Please authenticate again.',
                   step: 'auth_required'
               });
           }
           
           const result = await this.emailsService.autoProcessAllEmails(sessionId, provider, maxEmails, pdfRule, outputDir);
           
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

   @Get('pdf-rules')
   async getPdfRules(): Promise<ApiResponse<{ rules: PdfRule[]; descriptions: Record<string, string> }>> {
       return this.createResponse(true, {
           rules: Object.values(PdfRule),
           descriptions: {
               [PdfRule.MAIN_BODY_WITH_ATTACHMENT]: 'Merge email body with PDF attachments into one file',
               [PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT]: 'Generate separate PDFs for email and each attachment',
               [PdfRule.ATTACHMENT_ONLY]: 'Generate PDFs from attachments only, skip email body'
           }
       });
   }

   @Get(':messageId/page-count')
   async getEmailPageCount(
       @Param('messageId') messageId: string,
       @Query('sessionId') sessionId: string,
       @Query('provider') provider: EmailProvider
   ): Promise<ApiResponse<{ pageCount: number }>> {
       this.validateSessionId(sessionId);
       this.validateProvider(provider);

       try {
           await this.emailsService.setSessionId(sessionId, provider);
           const pageCount = await this.emailsService.getEmailPageCount(messageId, provider);
           return this.createResponse(true, { pageCount });
       } catch (error) {
           throw new HttpException(
               this.createResponse(false, undefined, error.message),
               HttpStatus.INTERNAL_SERVER_ERROR
           );
       }
   }

   @Get(':messageId/processing-status')
    async getProcessingStatus(
        @Param('messageId') messageId: string,
        @Query('sessionId') sessionId: string
    ): Promise<ApiResponse<any>> {
        this.validateSessionId(sessionId);

        try {
            const status = await this.emailsService.getEmailProcessingStatus(messageId);
            return this.createResponse(true, status);
        } catch (error) {
            throw new HttpException(
                this.createResponse(false, undefined, error.message),
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Get(':messageId/rule-files/:pdfRule')
    async getRuleFiles(
        @Param('messageId') messageId: string,
        @Param('pdfRule') pdfRule: PdfRule,
        @Query('sessionId') sessionId: string
    ): Promise<ApiResponse<{ files: string[] }>> {
        this.validateSessionId(sessionId);

        try {
            const files = await this.emailsService.getRuleFiles(messageId, pdfRule);
            return this.createResponse(true, { files });
        } catch (error) {
            throw new HttpException(
                this.createResponse(false, undefined, error.message),
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Get('providers')
    async getProviders(): Promise<ApiResponse<{ providers: EmailProvider[]; descriptions: Record<string, string> }>> {
        return this.createResponse(true, {
            providers: Object.values(EmailProvider),
            descriptions: {
                [EmailProvider.GMAIL]: 'Google Gmail service',
                [EmailProvider.OUTLOOK]: 'Microsoft Outlook/Hotmail service'
            }
        });
    }

    @Get('webhook/status')
    async getWebhookStatus(
        @Query('sessionId') sessionId: string
    ): Promise<ApiResponse<WebhookStatusResponse>> {
        this.validateSessionId(sessionId);
        
        try {
            const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
            
            if (!fs.existsSync(subscriptionFile)) {
                return this.createResponse(true, {
                    isActive: false,
                    subscriptionId: undefined,
                    webhookUrl: undefined,
                    lastActivity: undefined,
                    pdfRule: undefined,
                    outputDir: undefined,
                    notifyUrl: undefined
                });
            }
            
            const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
            
            const token = await this.authService.getOutlookAccessToken(sessionId);
            let isActive = false;
            
            if (subscriptionData.subscriptionId) {
                try {
                    const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionData.subscriptionId}`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        isActive = new Date(data.expirationDateTime) > new Date();
                        subscriptionData.expirationDateTime = data.expirationDateTime;
                    }
                } catch (error) {
                    console.warn('Failed to check subscription status:', error);
                }
            }
            
            return this.createResponse(true, {
                isActive,
                subscriptionId: subscriptionData.subscriptionId,
                webhookUrl: subscriptionData.webhookUrl,
                lastActivity: subscriptionData.lastActivity,
                pdfRule: subscriptionData.pdfRule,
                outputDir: subscriptionData.outputDir,
                notifyUrl: subscriptionData.notifyUrl,
                expirationDateTime: subscriptionData.expirationDateTime
            });
        } catch (error) {
            return this.createResponse(false, {
                isActive: false,
                subscriptionId: undefined,
                webhookUrl: undefined,
                lastActivity: undefined,
                pdfRule: undefined,
                outputDir: undefined,
                notifyUrl: undefined
            }, error.message);
        }
    }

    private async autoCreateWebhookSubscription(
        sessionId: string,
        pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
        outputDir?: string,
        notifyUrl?: string
    ): Promise<{ success: boolean; data?: any; error?: string }> {
        try {
            const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
            if (!webhookBaseUrl) {
                return { success: false, error: 'WEBHOOK_BASE_URL environment variable not set' };
            }

            const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
            
            if (fs.existsSync(subscriptionFile)) {
                const existing = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                if (existing.subscriptionId) {
                    try {
                        const token = await this.authService.getOutlookAccessToken(sessionId);
                        const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${existing.subscriptionId}`, {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            const isActive = new Date(data.expirationDateTime) > new Date();
                            if (isActive) {
                                return { success: true, data: { message: 'Subscription already exists and is active', subscriptionId: existing.subscriptionId } };
                            }
                        }
                    } catch (error) {
                        console.warn('Error checking existing subscription:', error);
                    }
                }
            }

            const token = await this.authService.getOutlookAccessToken(sessionId);
            const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
            
            let webhookUrl = `${webhookBaseUrl}/api/webhooks/outlook?sessionId=${sessionId}`;
            webhookUrl += `&pdfRule=${pdfRule}`;
            
            if (outputDir) {
                webhookUrl += `&outputDir=${encodeURIComponent(outputDir)}`;
            }
            
            if (notifyUrl) {
                webhookUrl += `&notifyUrl=${encodeURIComponent(notifyUrl)}`;
            }
            
            const subscriptionPayload = {
                changeType: 'created',
                notificationUrl: webhookUrl,
                resource: "me/mailFolders('Inbox')/messages",
                expirationDateTime: expiration.toISOString(),
                clientState: 'secure-state-123'
            };

            const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(subscriptionPayload)
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: `Graph API Error: ${data.error?.message || response.statusText}` };
            }

            const subscriptionInfo = {
                subscriptionId: data.id,
                expirationDateTime: data.expirationDateTime,
                resource: data.resource,
                webhookUrl,
                pdfRule: pdfRule,
                outputDir: outputDir || 'default',
                notifyUrl: notifyUrl || 'none',
                createdAt: new Date().toISOString()
            };
            
            fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionInfo, null, 2));

            return {
                success: true,
                data: {
                    subscriptionId: data.id,
                    expirationDateTime: data.expirationDateTime,
                    webhookUrl,
                    pdfRule
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    private async renewWebhookSubscription(sessionId: string, subscriptionId: string): Promise<{ success: boolean; data?: any; error?: string }> {
        try {
            const token = await this.authService.getOutlookAccessToken(sessionId);
            const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
            
            const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    expirationDateTime: expiration.toISOString()
                })
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: `Graph API Error: ${data.error?.message || response.statusText}` };
            }

            const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
            if (fs.existsSync(subscriptionFile)) {
                const subscriptionInfo = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                subscriptionInfo.expirationDateTime = data.expirationDateTime;
                subscriptionInfo.renewedAt = new Date().toISOString();
                fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionInfo, null, 2));
            }

            return {
                success: true,
                data: {
                    subscriptionId: data.id,
                    expirationDateTime: data.expirationDateTime
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    @Post('webhook/auto-subscribe')
    async autoSubscribeWebhook(
        @Body() body: { 
            sessionId: string; 
            pdfRule?: PdfRule; 
            outputDir?: string; 
            notifyUrl?: string;
        }
    ): Promise<ApiResponse<any>> {
        const { sessionId, pdfRule, outputDir, notifyUrl } = body;
        this.validateSessionId(sessionId);
        
        try {
            const result = await this.autoCreateWebhookSubscription(sessionId, pdfRule, outputDir, notifyUrl);
            
            if (result.success) {
                return this.createResponse(true, result.data);
            } else {
                return this.createResponse(false, undefined, result.error);
            }
        } catch (error) {
            return this.createResponse(false, undefined, error.message);
        }
    }

    @Post('webhook/renew')
    async renewWebhook(
        @Body() body: { sessionId: string; subscriptionId: string }
    ): Promise<ApiResponse<any>> {
        const { sessionId, subscriptionId } = body;
        this.validateSessionId(sessionId);
        
        try {
            const result = await this.renewWebhookSubscription(sessionId, subscriptionId);
            
            if (result.success) {
                return this.createResponse(true, result.data);
            } else {
                return this.createResponse(false, undefined, result.error);
            }
        } catch (error) {
            return this.createResponse(false, undefined, error.message);
        }
    }

    @Post('webhook/auto-manage')
    async autoManageWebhook(
        @Body() body: { 
            sessionId: string; 
            pdfRule?: PdfRule; 
            outputDir?: string; 
            notifyUrl?: string;
        }
    ): Promise<ApiResponse<any>> {
        const { sessionId, pdfRule, outputDir, notifyUrl } = body;
        this.validateSessionId(sessionId);
        
        try {
            const subscriptionFile = path.join(process.cwd(), 'outlook_tokens', `${sessionId}_subscription.json`);
            
            if (fs.existsSync(subscriptionFile)) {
                const existing = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                if (existing.subscriptionId) {
                    try {
                        const token = await this.authService.getOutlookAccessToken(sessionId);
                        const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${existing.subscriptionId}`, {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            const expirationTime = new Date(data.expirationDateTime);
                            const now = new Date();
                            const hoursUntilExpiration = (expirationTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                            
                            if (hoursUntilExpiration > 12) {
                                return this.createResponse(true, { 
                                    message: 'Subscription is active and not expiring soon', 
                                    subscriptionId: existing.subscriptionId,
                                    expirationDateTime: data.expirationDateTime
                                });
                            } else if (hoursUntilExpiration > 0) {
                                const renewResult = await this.renewWebhookSubscription(sessionId, existing.subscriptionId);
                                if (renewResult.success) {
                                    return this.createResponse(true, { 
                                        message: 'Subscription renewed successfully', 
                                        ...renewResult.data
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.warn('Error checking existing subscription, creating new one:', error);
                    }
                }
            }

            const result = await this.autoCreateWebhookSubscription(sessionId, pdfRule, outputDir, notifyUrl);
            
            if (result.success) {
                return this.createResponse(true, { 
                    message: 'New subscription created successfully', 
                    ...result.data
                });
            } else {
                return this.createResponse(false, undefined, result.error);
            }
        } catch (error) {
            return this.createResponse(false, undefined, error.message);
        }
    }
}