import { Controller, Get, Delete, Query, Param, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { GmailService } from '../gmail/gmail.service';

interface AuthResponse {
   authUrl: string;
   sessionId: string;
}

interface Email {
    messageId: string;
    subject: string;
    from: string;
    date: string;
    receiveDate: string;
    snippet: string;
}

interface EmailListResponse {
    emails: Email[];
    nextPageToken?: string;
}
@Controller('auth')
export class AuthController {
   constructor(
       private readonly authService: AuthService,
       private readonly gmailService: GmailService,
   ) {}

   @Get('start')
   async startAuth(): Promise<AuthResponse> {
       try {
           const sessionId = this.authService.generateSessionId();
           const authUrl = this.authService.generateAuthUrl(sessionId);

           return { authUrl, sessionId };
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('callback')
   async handleCallback(
       @Query('code') code: string,
       @Query('state') sessionId: string,
       @Res() res: Response
   ): Promise<void> {
       try {
           await this.authService.handleAuthCallback(code, sessionId);

           res.send(`
               <html>
                   <body>
                       <p>✅ Authentication successful. This window will close automatically.</p>
                       <script>
                           window.close();
                       </script>
                   </body>
               </html>
           `);
       } catch (error) {
           res.status(500).send(`❌ ${error.message}`);
       }
   }

   @Get('emails/:sessionId')
   async getEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 10,
       @Query('pageToken') pageToken?: string
   ) : Promise<EmailListResponse> {
       try {
           const result = await this.gmailService.getEmailList(maxResults, sessionId, pageToken);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Delete('users/:sessionId')
   deleteUser(@Param('sessionId') sessionId: string) {
       this.authService.deleteUser(sessionId);
       return { success: true };
   }
}