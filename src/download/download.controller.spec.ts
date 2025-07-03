import { Controller, Get, Post, Body, HttpStatus, HttpException } from '@nestjs/common';
import { DownloadService } from './download.service';

interface UpdateDownloadSettingsDto {
   useCustomPath?: boolean;
   customPath?: string;
}

interface ApiResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
}

@Controller('download')
export class DownloadController {
   constructor(private readonly downloadService: DownloadService) {}

   @Get()
   getCurrentSettings(): ApiResponse {
       try {
           const settings = this.downloadService.loadSettings();
           return {
               success: true,
               data: settings
           };
       } catch (error) {
           throw new HttpException({
               success: false,
               error: error.message
           }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Post()
   updateSettings(@Body() body: UpdateDownloadSettingsDto): ApiResponse {
       try {
           const { useCustomPath, customPath } = body;
           
           if (useCustomPath && customPath) {
               const validation = this.downloadService.validatePath(customPath);
               if (!validation.valid) {
                   throw new HttpException({
                       success: false,
                       error: validation.message
                   }, HttpStatus.BAD_REQUEST);
               }
               
               if (!this.downloadService.ensureDirectory(customPath)) {
                   throw new HttpException({
                       success: false,
                       error: 'Cannot create directory'
                   }, HttpStatus.BAD_REQUEST);
               }
           }
           
           const result = this.downloadService.saveSettings({ useCustomPath, customPath });
           
           if (!result.success) {
               throw new HttpException({
                   success: false,
                   error: result.error
               }, HttpStatus.INTERNAL_SERVER_ERROR);
           }
           
           return {
               success: true,
               data: result.settings
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
}