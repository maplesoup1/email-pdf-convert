import { Controller, Post, Get, Delete, Body, Query } from '@nestjs/common';
import { AutoProcessService, AutoProcessConfig } from './auto.service';
import { PdfRule } from '../emails/emails.entity';

interface StartAutoProcessDto {
  sessionId: string;
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
      pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT,
      maxEmailsPerRun = 50,
      intervalMinutes = 60
    } = dto;

    this.autoProcessService.startAutoProcess(
      sessionId,
      pdfRule,
      maxEmailsPerRun,
      intervalMinutes
    );

    return {
      success: true,
      message: 'Auto process started',
      config: {
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
  getStatus(): { success: boolean; data: { enabled: boolean; isProcessing: boolean; config: Omit<AutoProcessConfig, "sessionId">; } | null; } {
    const status = this.autoProcessService.getAutoProcessStatus();

    return {
      success: true,
      data: status
    };
  }
}