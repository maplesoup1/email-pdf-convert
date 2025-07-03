import { Controller, Post, Body, Res, HttpStatus, Get, Param, Query, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { PdfService, PdfProcessingOption } from '../pdf/pdf.service';
import { EmailsService } from '../emails/emails.service';
import { GmailService } from '../gmail/gmail.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { HtmlService } from '../html/html.service';
import { PuppeteerService } from '../puppeteer/puppeteer.service';
import * as fs from 'fs';
import * as path from 'path';

interface ProcessPdfRequest {
  messageId: string;
  sessionId: string;
  option: PdfProcessingOption;
  outputDir?: string;
}

interface ProcessMultiplePdfsRequest {
  messageIds: string[];
  sessionId: string;
  option: PdfProcessingOption;
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
  option: PdfProcessingOption;
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
      return error.message;
    }
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private writeResultFiles(result: any, outputDir: string, option: PdfProcessingOption): string[] {
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
        const attachmentIndex = option === PdfProcessingOption.SEPARATE_EMAIL_AND_ATTACHMENTS ? index + 1 : index;
        const attachmentPath = path.join(outputDir, result.filenames[attachmentIndex]);
        fs.writeFileSync(attachmentPath, attachmentBuffer);
        outputPaths.push(attachmentPath);
      });
    }

    return outputPaths;
  }

  @Post('process-email')
  async processEmailToPdf(@Body() request: ProcessPdfRequest, @Res() res: Response) {
    const response = await this.handleRequest(
      async () => {
        this.emailsService.setSessionId(request.sessionId);
        return await this.emailsService.processEmail(
          request.messageId,
          request.option,
          request.outputDir
        );
      },
      'Email processed to PDF successfully',
      'Failed to process email to PDF'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
  }

  @Post('process-multiple-emails')
  async processMultipleEmailsToPdf(@Body() request: ProcessMultiplePdfsRequest, @Res() res: Response) {
    const response = await this.handleRequest(
      async () => {
        this.emailsService.setSessionId(request.sessionId);
        return await this.emailsService.processMultipleEmails(
          request.messageIds,
          request.option,
          request.outputDir
        );
      },
      'Multiple emails processed to PDF successfully',
      'Failed to process multiple emails to PDF'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
  }

  @Post('process-direct')
  async processDirectPdf(@Body() request: DirectPdfProcessRequest, @Res() res: Response) {
    const response = await this.handleRequest(
      async () => {
        const emailPdfBuffer = await this.puppeteerService.convertHtmlToPdf(
          request.emailHtml,
          null!,
          true
        );

        const result = await this.pdfService.processPdfWithOptions(
          emailPdfBuffer,
          request.attachmentFiles,
          request.emailHeaders,
          request.attachmentFiles.map(f => path.basename(f)),
          request.option,
          'direct_' + Date.now()
        );

        const outputDir = request.outputDir || './downloads';
        const outputPaths = this.writeResultFiles(result, outputDir, request.option);

        return {
          option: result.option,
          filenames: result.filenames,
          outputPaths,
          processedFiles: outputPaths.length
        };
      },
      'Direct PDF processing completed successfully',
      'Failed to process direct PDF'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
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
    },
    @Res() res: Response
  ) {
    const response = await this.handleRequest(
      async () => {
        const emailPdfBuffer = fs.readFileSync(body.emailPdfPath);
        const attachmentNames = body.attachmentPdfPaths.map(p => path.basename(p));

        const mergedPdfBuffer = await this.pdfService.mergePDFs(
          emailPdfBuffer,
          body.attachmentPdfPaths,
          body.emailHeaders,
          attachmentNames
        );

        fs.writeFileSync(body.outputPath, mergedPdfBuffer);

        return {
          outputPath: body.outputPath,
          size: mergedPdfBuffer.length
        };
      },
      'PDFs merged successfully',
      'Failed to merge PDFs'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
  }

  @Get('page-count/:messageId')
  async getEmailPageCount(
    @Param('messageId') messageId: string,
    @Query('sessionId') sessionId: string,
    @Res() res: Response
  ) {
    if (!sessionId) {
      throw new HttpException('SessionId is required', HttpStatus.BAD_REQUEST);
    }

    const response = await this.handleRequest(
      async () => {
        this.emailsService.setSessionId(sessionId);
        const pageCount = await this.emailsService.getEmailPageCount(messageId);
        return { pageCount };
      },
      'Page count retrieved successfully',
      'Failed to get page count'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
  }

  @Post('generate-filename')
  async generateSafeFileName(
    @Body() body: {
      subject: string;
      messageId: string;
      isMerged?: boolean;
    },
    @Res() res: Response
  ) {
    const response = await this.handleRequest(
      async () => ({
        filename: this.pdfService.generateSafeFileName(
          body.subject,
          body.messageId,
          body.isMerged || false
        )
      }),
      'Safe filename generated successfully',
      'Failed to generate safe filename'
    );

    return res.status(response.success ? HttpStatus.OK : HttpStatus.INTERNAL_SERVER_ERROR).json(response);
  }
}