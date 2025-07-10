import { Controller, Post, Get, Delete, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { AutoProcessService, AutoProcessConfig } from './auto.service';
import { EmailProvider } from '../emails/emails.service';
import { PdfRule } from '../emails/emails.entity';

interface StartAutoProcessDto {
  sessionId: string;
  provider: EmailProvider;
  pdfRule?: PdfRule;
  maxEmailsPerRun?: number;
  intervalMinutes?: number;
}

interface UpdateConfigDto {
  enabled?: boolean;
  provider?: EmailProvider;
  pdfRule?: PdfRule;
  maxEmailsPerRun?: number;
  intervalMinutes?: number;
}

@Controller('auto-process')
export class AutoProcessController {
  constructor(private readonly autoProcessService: AutoProcessService) {}

  @Post('start')
  startAutoProcess(@Body() dto: StartAutoProcessDto) {
    const {
      sessionId,
      provider,
      pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      maxEmailsPerRun = 50,
      intervalMinutes = 60
    } = dto;

    if (!sessionId) {
      throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
    }

    if (!provider || !Object.values(EmailProvider).includes(provider)) {
      throw new HttpException('Valid provider (gmail/outlook) is required', HttpStatus.BAD_REQUEST);
    }

    this.autoProcessService.startAutoProcess(
      sessionId,
      provider,
      pdfRule,
      maxEmailsPerRun,
      intervalMinutes
    );

    return {
      success: true,
      message: `Auto process started for ${provider}`,
      config: {
        provider,
        pdfRule,
        maxEmailsPerRun,
        intervalMinutes
      }
    };
  }

  @Delete('stop')
  stopAutoProcess() {
    this.autoProcessService.stopAutoProcess();

    return {
      success: true,
      message: 'Auto process stopped'
    };
  }

  @Get('status')
  getStatus(): { 
    success: boolean; 
    data: { 
      enabled: boolean; 
      isProcessing: boolean; 
      config: Omit<AutoProcessConfig, "sessionId">; 
    } | null; 
  } {
    const status = this.autoProcessService.getAutoProcessStatus();

    return {
      success: true,
      data: status
    };
  }

  @Post('config')
  updateConfig(@Body() dto: UpdateConfigDto) {
    try {
      this.autoProcessService.updateConfig(dto);

      return {
        success: true,
        message: 'Configuration updated successfully',
        config: this.autoProcessService.getAutoProcessStatus().config
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to update configuration', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('config')
  getCurrentConfig() {
    const config = this.autoProcessService.getCurrentConfig();
    
    return {
      success: true,
      data: {
        enabled: config.enabled,
        provider: config.provider,
        pdfRule: config.pdfRule,
        maxEmailsPerRun: config.maxEmailsPerRun,
        intervalMinutes: config.intervalMinutes
      }
    };
  }

  @Post('test-connection')
  async testConnection() {
    try {
      const result = await this.autoProcessService.testConnection();
      
      return {
        success: result.success,
        message: result.success ? 'Connection test successful' : 'Connection test failed',
        ...(result.error && { error: result.error })
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Connection test failed', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('force-run')
  async forceRun() {
    try {
      const result = await this.autoProcessService.forceRun();
      
      return {
        success: result.success,
        message: result.success 
          ? `Force run completed. Processed ${result.processed} emails.`
          : 'Force run failed',
        processed: result.processed,
        ...(result.error && { error: result.error })
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Force run failed', error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('providers')
  getProviders() {
    return {
      success: true,
      data: {
        providers: Object.values(EmailProvider),
        descriptions: {
          [EmailProvider.GMAIL]: 'Google Gmail auto-processing',
          [EmailProvider.OUTLOOK]: 'Microsoft Outlook/Hotmail auto-processing'
        }
      }
    };
  }

  @Get('rules')
  getPdfRules() {
    return {
      success: true,
      data: {
        rules: Object.values(PdfRule),
        descriptions: {
          [PdfRule.MAIN_BODY_WITH_ATTACHMENT]: 'Merge email body with PDF attachments into one file',
          [PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT]: 'Generate separate PDFs for email and each attachment',
          [PdfRule.ATTACHMENT_ONLY]: 'Generate PDFs from attachments only, skip email body'
        }
      }
    };
  }
}