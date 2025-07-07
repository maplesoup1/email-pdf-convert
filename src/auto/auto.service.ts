import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailsService } from '../emails/emails.service';   
import { GmailService } from '../gmail/gmail.service';
import { PdfRule } from '../emails/emails.entity';

export interface AutoProcessConfig {
  enabled: boolean;
  sessionId: string;
  pdfRule: PdfRule;
  maxEmailsPerRun: number;
  intervalMinutes: number;
}

@Injectable()
export class AutoProcessService {
  private config: AutoProcessConfig = {
    enabled: false,
    sessionId: '',
    pdfRule: PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    maxEmailsPerRun: 50,
    intervalMinutes: 60
  };

  private isProcessing = false;

  constructor(
    private readonly emailsService: EmailsService,
    private readonly gmailService: GmailService,
  ) {}

  startAutoProcess(
    sessionId: string,
    pdfRule: PdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
    maxEmailsPerRun: number = 50,
    intervalMinutes: number = 60
  ): void {
    this.config = {
      enabled: true,
      sessionId,
      pdfRule,
      maxEmailsPerRun,
      intervalMinutes
    };
  }

  stopAutoProcess(): void {
    this.config.enabled = false;
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
    const lastRunKey = 'lastAutoProcessRun';
    const lastRun = this.getLastRunTime();
    
    if (lastRun && (now.getTime() - lastRun.getTime()) < (this.config.intervalMinutes * 60 * 1000)) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.emailsService.setSessionId(this.config.sessionId);
      
      const recentEmails = await this.gmailService.getRecentEmails(
        this.config.sessionId,
        this.config.maxEmailsPerRun
      );

      if (recentEmails.emails.length === 0) {
        return;
      }

      const messageIds = recentEmails.emails.map(email => email.messageId);
      
      await this.emailsService.processMultipleEmails(
        messageIds,
        this.config.pdfRule
      );

      this.setLastRunTime(now);

    } catch (error) {
      this.config.enabled = false;
    } finally {
      this.isProcessing = false;
    }
  }

  private getLastRunTime(): Date | null {
    const stored = global['lastAutoProcessRun'];
    return stored ? new Date(stored) : null;
  }

  private setLastRunTime(time: Date): void {
    global['lastAutoProcessRun'] = time.toISOString();
  }
}