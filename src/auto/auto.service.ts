import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailsService, EmailProvider } from '../emails/emails.service';   
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';
import { PdfRule } from '../emails/emails.entity';

export interface AutoProcessConfig {
  enabled: boolean;
  sessionId: string;
  provider: EmailProvider;
  pdfRule: PdfRule;
  maxEmailsPerRun: number;
  intervalMinutes: number;
}

@Injectable()
export class AutoProcessService {
  private config: AutoProcessConfig = {
    enabled: false,
    sessionId: '',
    provider: EmailProvider.GMAIL,
    pdfRule: PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    maxEmailsPerRun: 50,
    intervalMinutes: 60
  };

  private isProcessing = false;

  constructor(
    private readonly emailsService: EmailsService,
    private readonly gmailService: GmailService,
    private readonly outlookService: OutlookService,
  ) {}

  startAutoProcess(
    sessionId: string,
    provider: EmailProvider = EmailProvider.GMAIL,
    pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    maxEmailsPerRun: number = 50,
    intervalMinutes: number = 60
  ): void {
    this.config = {
      enabled: true,
      sessionId,
      provider,
      pdfRule,
      maxEmailsPerRun,
      intervalMinutes
    };
    
    console.log(`Auto-process started for ${provider} with sessionId: ${sessionId}`);
  }

  stopAutoProcess(): void {
    this.config.enabled = false;
    console.log('Auto-process stopped');
  }

  getAutoProcessStatus(): {
    enabled: boolean;
    isProcessing: boolean;
    config: Omit<AutoProcessConfig, 'sessionId'>;
  } {
    return {
      enabled: this.config.enabled,
      isProcessing: this.isProcessing,
      config: {
        enabled: this.config.enabled,
        provider: this.config.provider,
        pdfRule: this.config.pdfRule,
        maxEmailsPerRun: this.config.maxEmailsPerRun,
        intervalMinutes: this.config.intervalMinutes
      }
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  private async autoProcessEmails(): Promise<void> {
    if (!this.config.enabled || this.isProcessing || !this.config.sessionId) {
      return;
    }

    const now = new Date();
    const lastRun = this.getLastRunTime(this.config.provider);
    
    if (lastRun && (now.getTime() - lastRun.getTime()) < (this.config.intervalMinutes * 60 * 1000)) {
      return;
    }

    this.isProcessing = true;

    try {
      console.log(`Starting auto-process for ${this.config.provider}...`);
      
      await this.emailsService.setSessionId(this.config.sessionId, this.config.provider);
      
      const recentEmails = await this.getRecentEmails();

      if (recentEmails.emails.length === 0) {
        console.log(`No recent emails found for ${this.config.provider}`);
        return;
      }

      console.log(`Processing ${recentEmails.emails.length} emails from ${this.config.provider}`);

      const messageIds = recentEmails.emails.map(email => email.messageId);
      
      await this.emailsService.processMultipleEmails(
        messageIds,
        this.config.pdfRule,
        undefined,
        this.config.provider
      );

      this.setLastRunTime(now, this.config.provider);
      console.log(`Auto-process completed for ${this.config.provider}`);

    } catch (error) {
      console.error(`Auto-process failed for ${this.config.provider}:`, error);
      this.config.enabled = false;
    } finally {
      this.isProcessing = false;
    }
  }

  private async getRecentEmails() {
    if (this.config.provider === EmailProvider.GMAIL) {
      return await this.gmailService.getRecentEmails(
        this.config.sessionId,
        this.config.maxEmailsPerRun
      );
    } else if (this.config.provider === EmailProvider.OUTLOOK) {
      return await this.outlookService.getRecentEmails(
        this.config.sessionId,
        this.config.maxEmailsPerRun
      );
    } else {
      throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  private getLastRunTime(provider: EmailProvider): Date | null {
    const key = `lastAutoProcessRun_${provider}`;
    const stored = global[key];
    return stored ? new Date(stored) : null;
  }

  private setLastRunTime(time: Date, provider: EmailProvider): void {
    const key = `lastAutoProcessRun_${provider}`;
    global[key] = time.toISOString();
  }

  updateConfig(updates: Partial<Omit<AutoProcessConfig, 'sessionId'>>): void {
    this.config = {
      ...this.config,
      ...updates
    };
    
    console.log('Auto-process config updated:', {
      enabled: this.config.enabled,
      provider: this.config.provider,
      pdfRule: this.config.pdfRule,
      maxEmailsPerRun: this.config.maxEmailsPerRun,
      intervalMinutes: this.config.intervalMinutes
    });
  }

  getCurrentConfig(): AutoProcessConfig {
    return { ...this.config };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.sessionId || !this.config.provider) {
      return { success: false, error: 'Session ID or provider not configured' };
    }

    try {
      await this.emailsService.setSessionId(this.config.sessionId, this.config.provider);
      
      let userEmail: string;
      if (this.config.provider === EmailProvider.GMAIL) {
        userEmail = await this.gmailService.getAuthenticatedUserEmail(this.config.sessionId);
      } else if (this.config.provider === EmailProvider.OUTLOOK) {
        userEmail = await this.outlookService.getAuthenticatedUserEmail(this.config.sessionId);
      } else {
        throw new Error(`Unsupported provider: ${this.config.provider}`);
      }

      return { 
        success: true, 
        error: undefined 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  async forceRun(): Promise<{ success: boolean; processed: number; error?: string }> {
    if (this.isProcessing) {
      return { success: false, processed: 0, error: 'Auto-process is already running' };
    }

    if (!this.config.sessionId || !this.config.provider) {
      return { success: false, processed: 0, error: 'Session ID or provider not configured' };
    }

    this.isProcessing = true;
    let processedCount = 0;

    try {
      await this.emailsService.setSessionId(this.config.sessionId, this.config.provider);
      
      const recentEmails = await this.getRecentEmails();
      processedCount = recentEmails.emails.length;

      if (processedCount === 0) {
        return { success: true, processed: 0 };
      }

      const messageIds = recentEmails.emails.map(email => email.messageId);
      
      await this.emailsService.processMultipleEmails(
        messageIds,
        this.config.pdfRule,
        undefined,
        this.config.provider
      );

      this.setLastRunTime(new Date(), this.config.provider);

      return { success: true, processed: processedCount };
    } catch (error) {
      return { success: false, processed: 0, error: error.message };
    } finally {
      this.isProcessing = false;
    }
  }
}