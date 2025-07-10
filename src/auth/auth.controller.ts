import { Controller, Get, Delete, Query, Param, Res, HttpStatus, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { GmailService } from '../gmail/gmail.service';
import { OutlookService } from '../outlook/outlook.service';

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

interface EmailMessage {
    messageId: string;
    threadId: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    body: string;
    isHtml: boolean;
    payload: any;
}

interface EmailListResponse {
    emails: Email[];
    nextPageToken?: string;
}

interface UserListResponse {
    gmail: string[];
    outlook: string[];
}

@Controller('auth')
export class AuthController {
   constructor(
       private readonly authService: AuthService,
       private readonly gmailService: GmailService,
       private readonly outlookService: OutlookService,
   ) {}

   @Get('gmail/start')
   async startGmailAuth(): Promise<AuthResponse> {
       try {
           const sessionId = this.authService.generateSessionId();
           const authUrl = this.authService.generateAuthUrl(sessionId);

           return { authUrl, sessionId };
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('gmail/callback')
   async handleGmailCallback(
       @Query('code') code: string,
       @Query('state') sessionId: string,
       @Res() res: Response
   ): Promise<void> {
       try {
           await this.authService.handleAuthCallback(code, sessionId);

           res.send(`
               <html>
                   <body>
                       <p>✅ Gmail Authentication successful. This window will close automatically.</p>
                       <script>
                           window.close();
                       </script>
                   </body>
               </html>
           `);
       } catch (error) {
           res.status(500).send(`❌ Gmail Auth Error: ${error.message}`);
       }
   }

   @Get('outlook/start')
   async startOutlookAuth(): Promise<AuthResponse> {
       try {
           const sessionId = this.authService.generateSessionId();
           const authUrl = this.authService.generateOutlookAuthUrl(sessionId);

           return { authUrl, sessionId };
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('outlook/callback')
   async handleOutlookCallback(
       @Query('code') code: string,
       @Query('state') sessionId: string,
       @Res() res: Response
   ): Promise<void> {
       try {
           await this.authService.handleOutlookAuthCallback(code, sessionId);

           res.send(`
               <html>
                   <body>
                       <p>✅ Outlook Authentication successful. This window will close automatically.</p>
                       <script>
                    const sessionId = '${sessionId}';
                    if (window.opener && sessionId) {
                        window.opener.localStorage.setItem('sessionId', sessionId);
                        window.opener.postMessage({ type: 'outlook-auth-complete' }, '*');
                    }
                    window.close();
                       </script>
                   </body>
               </html>
           `);
       } catch (error) {
           res.status(500).send(`❌ Outlook Auth Error: ${error.message}`);
       }
   }

   @Get('start')
   async startAuth(): Promise<AuthResponse> {
       return this.startGmailAuth();
   }

   @Get('callback')
   async handleCallback(
       @Query('code') code: string,
       @Query('state') sessionId: string,
       @Res() res: Response
   ): Promise<void> {
       return this.handleGmailCallback(code, sessionId, res);
   }

   @Get('gmail/emails/:sessionId')
   async getGmailEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 10,
       @Query('pageToken') pageToken?: string
   ): Promise<EmailListResponse> {
       try {
           const result = await this.gmailService.getEmailList(maxResults, sessionId, pageToken);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('gmail/emails/:sessionId/recent')
   async getRecentGmailEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 50
   ): Promise<EmailListResponse> {
       try {
           const result = await this.gmailService.getRecentEmails(sessionId, maxResults);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('gmail/email/:sessionId/:messageId')
   async getGmailEmailById(
       @Param('sessionId') sessionId: string,
       @Param('messageId') messageId: string
   ): Promise<EmailMessage> {
       try {
           const result = await this.gmailService.getEmailById(messageId, sessionId);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('outlook/emails/:sessionId')
   async getOutlookEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 10,
       @Query('pageToken') pageToken?: string
   ): Promise<EmailListResponse> {
       try {
           const result = await this.outlookService.getEmailList(maxResults, sessionId, pageToken);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('outlook/emails/:sessionId/recent')
   async getRecentOutlookEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 50
   ): Promise<EmailListResponse> {
       try {
           const result = await this.outlookService.getRecentEmails(sessionId, maxResults);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('outlook/email/:sessionId/:messageId')
   async getOutlookEmailById(
       @Param('sessionId') sessionId: string,
       @Param('messageId') messageId: string
   ): Promise<EmailMessage> {
       try {
           const result = await this.outlookService.getEmailById(messageId, sessionId);
           return result;
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('emails/:sessionId')
   async getEmails(
       @Param('sessionId') sessionId: string,
       @Query('maxResults') maxResults: number = 10,
       @Query('pageToken') pageToken?: string
   ): Promise<EmailListResponse> {
       return this.getGmailEmails(sessionId, maxResults, pageToken);
   }

   @Get('users')
   getUsers(): UserListResponse {
       return {
           gmail: this.authService.listAuthorizedUsers(),
           outlook: this.authService.listAuthorizedOutlookUsers()
       };
   }

   @Delete('gmail/users/:sessionId')
   deleteGmailUser(@Param('sessionId') sessionId: string) {
       this.authService.deleteUser(sessionId);
       return { success: true, provider: 'gmail' };
   }

   @Delete('outlook/users/:sessionId')
   deleteOutlookUser(@Param('sessionId') sessionId: string) {
       this.authService.deleteOutlookUser(sessionId);
       return { success: true, provider: 'outlook' };
   }

   @Delete('users/:sessionId')
   deleteUser(@Param('sessionId') sessionId: string) {
       return this.deleteGmailUser(sessionId);
   }

   @Get('gmail/user/:sessionId')
   async getGmailUserEmail(@Param('sessionId') sessionId: string) {
       try {
           const email = await this.gmailService.getAuthenticatedUserEmail(sessionId);
           return { email, provider: 'gmail' };
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('outlook/user/:sessionId')
   async getOutlookUserEmail(@Param('sessionId') sessionId: string) {
       try {
           const email = await this.outlookService.getAuthenticatedUserEmail(sessionId);
           return { email, provider: 'outlook' };
       } catch (error) {
           throw new HttpException({ error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
       }
   }

   @Get('status')
   getAuthStatus() {
       return {
           gmail: {
               hasPreConfigured: this.authService.hasPreConfiguredTokens(),
               authorizedUsers: this.authService.listAuthorizedUsers().length
           },
           outlook: {
               hasPreConfigured: this.authService.hasPreConfiguredOutlookTokens(),
               authorizedUsers: this.authService.listAuthorizedOutlookUsers().length
           }
       };
   }
}