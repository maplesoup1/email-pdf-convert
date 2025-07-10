import { Injectable } from '@nestjs/common';
import { EmailsService, EmailProvider } from '../emails/emails.service';
import { PdfRule } from '../emails/emails.entity';

interface WebhookProcessResult {
    processed: number;
    failed: number;
    details: Array<{
        messageId: string;
        subject: string;
        status: 'success' | 'failed';
        error?: string;
        pdfUrls?: string[];
    }>;
}

@Injectable()
export class WebhookService {
    constructor(
        private readonly emailsService: EmailsService
    ) {}

    async processOutlookNotification(
        notifications: any[],
        sessionId: string,
        pdfRule: PdfRule,
        outputDir?: string,
        notifyUrl?: string
    ): Promise<WebhookProcessResult> {
        console.log('🔍 Starting processOutlookNotification...');
        console.log('📊 Notifications received:', notifications.length);
        console.log('🔔 Subscription ID:', notifications?.[0]?.subscriptionId);
        console.log('🔑 SessionId:', sessionId);
        console.log('📋 PDF Rule:', pdfRule);
        
        const result: WebhookProcessResult = {
            processed: 0,
            failed: 0,
            details: []
        };

        try {
            const newEmailNotifications = notifications.filter(
                notification => notification.changeType === 'created' && 
                notification.resource && 
                notification.resource.includes('Messages')
            );

            console.log('📧 New email notifications found:', newEmailNotifications.length);
            console.log('📧 Filtered notifications:', newEmailNotifications.map(n => ({ 
                changeType: n.changeType, 
                resource: n.resource 
            })));

            if (newEmailNotifications.length === 0) {
                console.log('❌ No new email notifications to process');
                return result;
            }

            for (const notification of newEmailNotifications) {
                const messageId = this.extractMessageId(notification.resource);
                console.log('📥 Processing notification with messageId:', messageId);
                console.log('📥 Full notification:', JSON.stringify(notification, null, 2));
                
                if (!messageId) {
                    console.log('❌ Could not extract messageId from resource:', notification.resource);
                    continue;
                }

                try {
                    console.log('⏳ Waiting 2 seconds before processing...');
                    await this.delay(2000);
                    
                    console.log('🔐 Setting session ID for EmailsService...');
                    await this.emailsService.setSessionId(sessionId, EmailProvider.OUTLOOK);
                    
                    console.log('🔄 Starting email processing...');
                    const processResult = await this.emailsService.processEmail(
                        messageId,
                        pdfRule,
                        outputDir,
                        EmailProvider.OUTLOOK
                    );

                    console.log('✅ Email processing completed successfully');
                    console.log('📄 Process result:', {
                        subject: processResult.subject,
                        pdfUrls: processResult.pdfUrls?.length || 0,
                        skipped: processResult.skipped
                    });

                    result.processed++;
                    result.details.push({
                        messageId,
                        subject: processResult.subject,
                        status: 'success',
                        pdfUrls: processResult.pdfUrls
                    });

                    if (notifyUrl) {
                        console.log('📣 Sending notification to:', notifyUrl);
                        await this.sendNotification(notifyUrl, {
                            type: 'email_converted',
                            messageId,
                            subject: processResult.subject,
                            pdfUrls: processResult.pdfUrls,
                            sessionId,
                            timestamp: new Date().toISOString()
                        });
                    }

                } catch (error) {
                    console.error('❌ Error processing email:', error);
                    console.error('❌ Error stack:', error.stack);
                    result.failed++;
                    result.details.push({
                        messageId,
                        subject: 'Unknown',
                        status: 'failed',
                        error: error.message
                    });
                }
            }

        } catch (error) {
            console.error('❌ Fatal error in processOutlookNotification:', error);
            throw error;
        }

        console.log('🏁 Final result:', result);
        return result;
    }

    private extractMessageId(resource: string): string | null {
        const match = resource.match(/Messages\/([^\/]+)$/);
        return match ? match[1] : null;
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async sendNotification(notifyUrl: string, data: any): Promise<void> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(notifyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailConverter-Webhook/1.0'
                },
                body: JSON.stringify(data),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

        } catch (error) {
            // Silent fail
        }
    }
}