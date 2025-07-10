import { Controller, Post, Body, Res, HttpStatus, Get, Param, Query, HttpException } from '@nestjs/common';
import { PdfService } from '../pdf/pdf.service';
import { EmailsService, EmailProcessResult, EmailProvider } from '../emails/emails.service';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import { PdfRule } from '../emails/emails.entity';
import * as fs from 'fs';
import * as path from 'path';

interface ProcessPdfRequest {
  messageId: string;
  sessionId: string;
  provider: EmailProvider;
  pdfRule: PdfRule;
  outputDir?: string;
}

interface ProcessMultiplePdfsRequest {
  messageIds: string[];
  sessionId: string;
  provider: EmailProvider;
  pdfRule: PdfRule;
  outputDir?: string;
}

interface DirectPdfProcessRequest {
  emailHtml: string;
  attachmentFiles: string[];
  emailHeaders: {
    subject: string;
    from: string;
    date: string;
  };
  pdfRule: PdfRule;
  outputDir?: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message: string;
}

@Controller('pdf')
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    private readonly emailsService: EmailsService,
    private readonly gmailService: GmailService,
    private readonly outlookService: OutlookService,
    private readonly attachmentsService: AttachmentsService,
    private readonly htmlService: HtmlService,
    private readonly puppeteerService: PuppeteerService,
  ) {}

  private createResponse<T>(success: boolean, data?: T, message?: string, error?: string): ApiResponse<T> {
    return {
      success,
      data,
      message: message || (success ? 'Operation completed successfully' : 'Operation failed'),
      ...(error && { error })
    };
  }

  private async handleRequest<T>(operation: () => Promise<T>, successMessage: string, errorMessage: string): Promise<ApiResponse<T>> {
    try {
      const result = await operation();
      return this.createResponse(true, result, successMessage);
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, errorMessage, error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
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

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private writeResultFiles(result: any, outputDir: string, pdfRule: PdfRule): string[] {
    this.ensureDirectoryExists(outputDir);
    const outputPaths: string[] = [];

    if (result.mergedPdf) {
      const mergedPath = path.join(outputDir, result.filenames[0]);
      fs.writeFileSync(mergedPath, result.mergedPdf);
      outputPaths.push(mergedPath);
    }

    if (result.emailPdf) {
      const emailPath = path.join(outputDir, result.filenames[0]);
      fs.writeFileSync(emailPath, result.emailPdf);
      outputPaths.push(emailPath);
    }

    if (result.attachmentPdfs) {
      result.attachmentPdfs.forEach((attachmentBuffer: Buffer, index: number) => {
        const attachmentIndex = pdfRule === PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT ? index + 1 : index;
        const attachmentPath = path.join(outputDir, result.filenames[attachmentIndex]);
        fs.writeFileSync(attachmentPath, attachmentBuffer);
        outputPaths.push(attachmentPath);
      });
    }

    return outputPaths;
  }

  @Post('process-email')
  async processEmailToPdf(@Body() request: ProcessPdfRequest): Promise<ApiResponse<EmailProcessResult>> {
    this.validateProvider(request.provider);
    
    try {
      await this.emailsService.setSessionId(request.sessionId, request.provider);
      const result = await this.emailsService.processEmail(
        request.messageId,
        request.pdfRule,
        request.outputDir,
        request.provider
      );
      
      return this.createResponse(true, result, `Email processed to PDF successfully via ${request.provider}`);
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, `Failed to process ${request.provider} email to PDF`, error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('process-multiple-emails')
  async processMultipleEmailsToPdf(@Body() request: ProcessMultiplePdfsRequest): Promise<ApiResponse<EmailProcessResult[]>> {
    this.validateProvider(request.provider);
    
    try {
      await this.emailsService.setSessionId(request.sessionId, request.provider);
      const result = await this.emailsService.processMultipleEmails(
        request.messageIds,
        request.pdfRule,
        request.outputDir,
        request.provider
      );
      
      return this.createResponse(true, result, `Multiple ${request.provider} emails processed to PDF successfully`);
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, `Failed to process multiple ${request.provider} emails to PDF`, error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('process-direct')
  async processDirectPdf(@Body() request: DirectPdfProcessRequest) {
    try {
      const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(
        request.emailHtml,
        null!,
        true
      );

      const result = await this.pdfService.processPdfWithRule(
        emailPdfBuffer,
        request.attachmentFiles,
        request.emailHeaders,
        request.attachmentFiles.map(f => path.basename(f)),
        request.pdfRule,
        'direct_' + Date.now()
      );

      const outputDir = request.outputDir || './downloads';
      const outputPaths = this.writeResultFiles(result, outputDir, request.pdfRule);

      return this.createResponse(true, {
        pdfRule: request.pdfRule,
        filenames: result.filenames,
        outputPaths,
        processedFiles: outputPaths.length
      }, 'Direct PDF processing completed successfully');
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, 'Failed to process direct PDF', error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('merge-pdfs')
  async mergePdfs(
    @Body() body: {
      emailPdfPath: string;
      attachmentPdfPaths: string[];
      emailHeaders: {
        subject: string;
        from: string;
        date: string;
      };
      outputPath: string;
    }
  ) {
    try {
      const emailPdfBuffer = fs.readFileSync(body.emailPdfPath);
      const attachmentNames = body.attachmentPdfPaths.map(p => path.basename(p));
      const messageId = 'merge_' + Date.now();

      const result = await this.pdfService.processPdfWithRule(
        emailPdfBuffer,
        body.attachmentPdfPaths,
        body.emailHeaders,
        attachmentNames,
        PdfRule.MAIN_BODY_WITH_ATTACHMENT,
        messageId
      );

      fs.writeFileSync(body.outputPath, result.mergedPdf!);

      return this.createResponse(true, {
        outputPath: body.outputPath,
        size: result.mergedPdf!.length
      }, 'PDFs merged successfully');
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, 'Failed to merge PDFs', error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('page-count/:messageId')
  async getEmailPageCount(
    @Param('messageId') messageId: string,
    @Query('sessionId') sessionId: string,
    @Query('provider') provider: EmailProvider
  ) {
    if (!sessionId) {
      throw new HttpException('SessionId is required', HttpStatus.BAD_REQUEST);
    }

    this.validateProvider(provider);

    try {
      await this.emailsService.setSessionId(sessionId, provider);
      const pageCount = await this.emailsService.getEmailPageCount(messageId, provider);
      return this.createResponse(true, { pageCount, provider }, `Page count retrieved successfully from ${provider}`);
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, `Failed to get page count from ${provider}`, error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('generate-filename')
  async generateSafeFileName(
    @Body() body: {
      subject: string;
      messageId: string;
      type?: string;
    }
  ) {
    try {
      const emailHeaders = { subject: body.subject, from: '', date: '' };
      const filename = this.pdfService.generateFilename(emailHeaders, body.messageId, body.type || 'email');
      
      return this.createResponse(true, { filename }, 'Safe filename generated successfully');
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, 'Failed to generate safe filename', error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('rules')
  async getPdfRules() {
    return this.createResponse(true, {
      rules: Object.values(PdfRule),
      descriptions: {
        [PdfRule.MAIN_BODY_WITH_ATTACHMENT]: 'Merge email body with PDF attachments into one file',
        [PdfRule.MAIN_BODY_SEPARATE_ATTACHMENT]: 'Generate separate PDFs for email and each attachment',
        [PdfRule.ATTACHMENT_ONLY]: 'Generate PDFs from attachments only, skip email body'
      }
    }, 'PDF rules retrieved successfully');
  }

  @Get('providers')
  async getProviders() {
    return this.createResponse(true, {
      providers: Object.values(EmailProvider),
      descriptions: {
        [EmailProvider.GMAIL]: 'Google Gmail email processing',
        [EmailProvider.OUTLOOK]: 'Microsoft Outlook/Hotmail email processing'
      }
    }, 'Email providers retrieved successfully');
  }

  @Post('auto-process')
  async autoProcessEmailsToPdf(
    @Body() body: {
      sessionId: string;
      provider: EmailProvider;
      maxEmails?: number;
      pdfRule?: PdfRule;
      outputDir?: string;
    }
  ) {
    const { sessionId, provider, maxEmails = 10, pdfRule = PdfRule.MAIN_BODY_WITH_ATTACHMENT, outputDir } = body;
    
    this.validateProvider(provider);

    try {
      const result = await this.emailsService.autoProcessAllEmails(
        sessionId,
        provider,
        maxEmails,
        pdfRule,
        outputDir
      );

      return this.createResponse(true, result, `Auto-processing completed for ${provider}`);
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, `Failed to auto-process ${provider} emails`, error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('processing-status/:messageId')
  async getProcessingStatus(
    @Param('messageId') messageId: string,
    @Query('sessionId') sessionId: string
  ) {
    if (!sessionId) {
      throw new HttpException('SessionId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const status = await this.emailsService.getEmailProcessingStatus(messageId);
      return this.createResponse(true, status, 'Processing status retrieved successfully');
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, 'Failed to get processing status', error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('rule-files/:messageId/:pdfRule')
  async getRuleFiles(
    @Param('messageId') messageId: string,
    @Param('pdfRule') pdfRule: PdfRule,
    @Query('sessionId') sessionId: string
  ) {
    if (!sessionId) {
      throw new HttpException('SessionId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const files = await this.emailsService.getRuleFiles(messageId, pdfRule);
      return this.createResponse(true, { files, pdfRule }, 'Rule files retrieved successfully');
    } catch (error) {
      throw new HttpException(
        this.createResponse(false, undefined, 'Failed to get rule files', error.message),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}