import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';

interface Credentials {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
}

interface OutlookCredentials {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    authority: string;
    scopes: string[];
}

interface TokenData {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expiry_date: number;
}

interface OutlookTokenData {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    expires_at: number;
}

// Custom Authentication Provider for Microsoft Graph
class CustomAuthProvider implements AuthenticationProvider {
    private accessToken: string;

    constructor(accessToken: string) {
        this.accessToken = accessToken;
    }

    async getAccessToken(): Promise<string> {
        return this.accessToken;
    }
}

@Injectable()
export class AuthService {
    private credentials: Credentials;
    private outlookCredentials: OutlookCredentials;
    private tokensDir: string;
    private outlookTokensDir: string;
    private preConfiguredTokens: TokenData | null = null;
    private preConfiguredOutlookTokens: OutlookTokenData | null = null;

    constructor() {
        this.credentials = this.loadCredentials();
        this.outlookCredentials = this.loadOutlookCredentials();
        this.tokensDir = path.join(process.cwd(), 'user_tokens');
        this.outlookTokensDir = path.join(process.cwd(), 'outlook_tokens');
        
        if (!fs.existsSync(this.tokensDir)) {
            fs.mkdirSync(this.tokensDir, { recursive: true });
        }

        if (!fs.existsSync(this.outlookTokensDir)) {
            fs.mkdirSync(this.outlookTokensDir, { recursive: true });
        }

        this.loadPreConfiguredTokens();
        this.loadPreConfiguredOutlookTokens();
    }

    private loadCredentials(): Credentials {
        if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI) {
            return {
                client_id: process.env.GMAIL_CLIENT_ID,
                client_secret: process.env.GMAIL_CLIENT_SECRET,
                redirect_uris: [process.env.GMAIL_REDIRECT_URI]
            };
        }

        try {
            const content = fs.readFileSync('credentials.json');
            const parsed = JSON.parse(content.toString());
            return parsed.web || parsed.installed;
        } catch (error) {
            throw new Error('No Gmail credentials found. Please provide environment variables or credentials.json file.');
        }
    }

    private loadOutlookCredentials(): OutlookCredentials {
        if (process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && process.env.OUTLOOK_REDIRECT_URI) {
            return {
                client_id: process.env.OUTLOOK_CLIENT_ID,
                client_secret: process.env.OUTLOOK_CLIENT_SECRET,
                redirect_uri: process.env.OUTLOOK_REDIRECT_URI,
                authority: process.env.OUTLOOK_AUTHORITY || 'https://login.microsoftonline.com/common',
                scopes: process.env.OUTLOOK_SCOPES ? process.env.OUTLOOK_SCOPES.split(' ') : [
                    'https://graph.microsoft.com/Mail.Read',
                    'https://graph.microsoft.com/Mail.ReadWrite',
                    'https://graph.microsoft.com/User.Read',
                    'offline_access'
                ]
            };
        }

        throw new Error('No Outlook credentials found. Please provide environment variables.');
    }

    private loadPreConfiguredTokens(): void {
        if (process.env.GMAIL_ACCESS_TOKEN && process.env.GMAIL_REFRESH_TOKEN) {
            this.preConfiguredTokens = {
                access_token: process.env.GMAIL_ACCESS_TOKEN,
                refresh_token: process.env.GMAIL_REFRESH_TOKEN,
                scope: process.env.GMAIL_SCOPE || 'https://www.googleapis.com/auth/gmail.readonly',
                token_type: process.env.GMAIL_TOKEN_TYPE || 'Bearer',
                expiry_date: parseInt(process.env.GMAIL_EXPIRY_DATE || '0')
            };
        }
    }

    private loadPreConfiguredOutlookTokens(): void {
        if (process.env.OUTLOOK_ACCESS_TOKEN && process.env.OUTLOOK_REFRESH_TOKEN) {
            this.preConfiguredOutlookTokens = {
                access_token: process.env.OUTLOOK_ACCESS_TOKEN,
                refresh_token: process.env.OUTLOOK_REFRESH_TOKEN,
                token_type: process.env.OUTLOOK_TOKEN_TYPE || 'Bearer',
                expires_in: parseInt(process.env.OUTLOOK_EXPIRES_IN || '3600'),
                scope: process.env.OUTLOOK_SCOPE || 'https://graph.microsoft.com/Mail.Read',
                expires_at: parseInt(process.env.OUTLOOK_EXPIRES_AT || '0')
            };
        }
    }

    generateSessionId(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    private createOAuthClient() {
        const { client_id, client_secret, redirect_uris } = this.credentials;
        return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    }

    private getUserTokenPath(sessionId: string): string {
        return path.join(this.tokensDir, `${sessionId}.json`);
    }

    private getOutlookTokenPath(sessionId: string): string {
        return path.join(this.outlookTokensDir, `${sessionId}.json`);
    }

    // Gmail methods (existing)
    generateAuthUrl(sessionId: string): string {
        const client = this.createOAuthClient();
        return client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/gmail.readonly'],
            state: sessionId,
            prompt: 'consent',
        });
    }

    async handleAuthCallback(code: string, sessionId: string): Promise<boolean> {
        const client = this.createOAuthClient();
        const { tokens } = await client.getToken(code);
        fs.writeFileSync(this.getUserTokenPath(sessionId), JSON.stringify(tokens, null, 2));
        return true;
    }

    async getGmailClient(sessionId?: string) {
        if (!sessionId && this.preConfiguredTokens) {
            const client = this.createOAuthClient();
            client.setCredentials(this.preConfiguredTokens);
            
            try {
                const gmail = google.gmail({ version: 'v1', auth: client });
                await gmail.users.getProfile({ userId: 'me' });
                return gmail;
            } catch (err) {
                throw new Error('Pre-configured token invalid or expired. Please use session-based authentication.');
            }
        }

        if (!sessionId) {
            throw new Error('Session ID is required when no pre-configured tokens are available.');
        }

        const tokenPath = this.getUserTokenPath(sessionId);
        if (!fs.existsSync(tokenPath)) {
            throw new Error('Token not found for sessionId');
        }

        let tokens;
        try {
            tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        } catch (err) {
            this.deleteUser(sessionId);
            throw new Error('Invalid token file, deleted. Please re-authenticate.');
        }

        const client = this.createOAuthClient();
        client.setCredentials(tokens);

        client.on('tokens', (newTokens) => {
            const merged = { ...tokens, ...newTokens };
            fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
        });

        try {
            const gmail = google.gmail({ version: 'v1', auth: client });
            await gmail.users.getProfile({ userId: 'me' });
            return gmail;
        } catch (err) {
            this.deleteUser(sessionId);
            throw new Error('Token invalid or expired, deleted. Please re-authenticate.');
        }
    }

    // Outlook methods (new)
    generateOutlookAuthUrl(sessionId: string): string {
        const { client_id, redirect_uri, authority, scopes } = this.outlookCredentials;
        
        const params = new URLSearchParams({
            client_id: client_id,
            response_type: 'code',
            redirect_uri: redirect_uri,
            scope: scopes.join(' '),
            state: sessionId,
            prompt: 'select_account',
            response_mode: 'query'
        });

        return `${authority}/oauth2/v2.0/authorize?${params.toString()}`;
    }

    async handleOutlookAuthCallback(code: string, sessionId: string): Promise<boolean> {
        const { client_id, client_secret, redirect_uri, authority, scopes } = this.outlookCredentials;
        
        const tokenEndpoint = `${authority}/oauth2/v2.0/token`;
        
        const params = new URLSearchParams({
            client_id: client_id,
            client_secret: client_secret,
            code: code,
            redirect_uri: redirect_uri,
            grant_type: 'authorization_code',
            scope: scopes.join(' ')
        });

        try {
            const response = await axios.post(tokenEndpoint, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const tokens: OutlookTokenData = {
                ...response.data,
                expires_at: Date.now() + (response.data.expires_in * 1000)
            };

            fs.writeFileSync(this.getOutlookTokenPath(sessionId), JSON.stringify(tokens, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to exchange code for tokens:', error);
            throw new Error('Failed to authenticate with Outlook');
        }
    }

    async getOutlookClient(sessionId?: string): Promise<Client> {
        let tokens: OutlookTokenData;

        if (!sessionId && this.preConfiguredOutlookTokens) {
            tokens = this.preConfiguredOutlookTokens;
        } else {
            if (!sessionId) {
                throw new Error('Session ID is required when no pre-configured tokens are available.');
            }

            const tokenPath = this.getOutlookTokenPath(sessionId);
            if (!fs.existsSync(tokenPath)) {
                throw new Error('Outlook token not found for sessionId');
            }

            try {
                tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            } catch (err) {
                this.deleteOutlookUser(sessionId);
                throw new Error('Invalid Outlook token file, deleted. Please re-authenticate.');
            }
        }

        // Check if token is expired and refresh if needed
        if (Date.now() >= tokens.expires_at) {
            try {
                tokens = await this.refreshOutlookToken(tokens, sessionId);
            } catch (error) {
                if (sessionId) {
                    this.deleteOutlookUser(sessionId);
                }
                throw new Error('Outlook token expired and refresh failed. Please re-authenticate.');
            }
        }

        const authProvider = new CustomAuthProvider(tokens.access_token);
        const graphClient = Client.initWithMiddleware({ authProvider });

        // Test the client
        try {
            await graphClient.api('/me').get();
            return graphClient;
        } catch (err) {
            if (sessionId) {
                this.deleteOutlookUser(sessionId);
            }
            throw new Error('Outlook token invalid or expired, deleted. Please re-authenticate.');
        }
    }

    private async refreshOutlookToken(tokens: OutlookTokenData, sessionId?: string): Promise<OutlookTokenData> {
        const { client_id, client_secret, authority } = this.outlookCredentials;
        const tokenEndpoint = `${authority}/oauth2/v2.0/token`;

        const params = new URLSearchParams({
            client_id: client_id,
            client_secret: client_secret,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token'
        });

        try {
            const response = await axios.post(tokenEndpoint, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const newTokens: OutlookTokenData = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || tokens.refresh_token,
                token_type: response.data.token_type,
                expires_in: response.data.expires_in,
                scope: response.data.scope,
                expires_at: Date.now() + (response.data.expires_in * 1000)
            };

            // Save refreshed tokens
            if (sessionId) {
                fs.writeFileSync(this.getOutlookTokenPath(sessionId), JSON.stringify(newTokens, null, 2));
            } else if (this.preConfiguredOutlookTokens) {
                this.preConfiguredOutlookTokens = newTokens;
            }

            return newTokens;
        } catch (error) {
            console.error('Failed to refresh Outlook token:', error);
            throw new Error('Failed to refresh Outlook token');
        }
    }

    // Enhanced list methods
    listAuthorizedUsers(): string[] {
        const users = fs.readdirSync(this.tokensDir)
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
        
        if (this.preConfiguredTokens) {
            users.unshift('pre-configured');
        }
        
        return users;
    }

    listAuthorizedOutlookUsers(): string[] {
        const users = fs.readdirSync(this.outlookTokensDir)
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
        
        if (this.preConfiguredOutlookTokens) {
            users.unshift('pre-configured');
        }
        
        return users;
    }

    deleteUser(sessionId: string): void {
        const tokenPath = this.getUserTokenPath(sessionId);
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
    }

    deleteOutlookUser(sessionId: string): void {
        const tokenPath = this.getOutlookTokenPath(sessionId);
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
    }

    hasPreConfiguredTokens(): boolean {
        return this.preConfiguredTokens !== null;
    }

    hasPreConfiguredOutlookTokens(): boolean {
        return this.preConfiguredOutlookTokens !== null;
    }

    async refreshPreConfiguredTokens(): Promise<void> {
        if (!this.preConfiguredTokens) {
            throw new Error('No pre-configured tokens available');
        }

        const client = this.createOAuthClient();
        client.setCredentials(this.preConfiguredTokens);

        try {
            const { credentials } = await client.refreshAccessToken();
            this.preConfiguredTokens = {
                access_token: credentials.access_token || '',
                refresh_token: credentials.refresh_token || this.preConfiguredTokens.refresh_token,
                scope: credentials.scope || this.preConfiguredTokens.scope,
                token_type: credentials.token_type || 'Bearer',
                expiry_date: credentials.expiry_date || 0
            };
        } catch (error) {
            throw new Error('Failed to refresh pre-configured tokens');
        }
    }

    async refreshPreConfiguredOutlookTokens(): Promise<void> {
        if (!this.preConfiguredOutlookTokens) {
            throw new Error('No pre-configured Outlook tokens available');
        }

        try {
            this.preConfiguredOutlookTokens = await this.refreshOutlookToken(this.preConfiguredOutlookTokens);
        } catch (error) {
            throw new Error('Failed to refresh pre-configured Outlook tokens');
        }
    }

    async getOutlookAccessToken(sessionId: string): Promise<string> {
        let tokens: OutlookTokenData;
    
        if (!sessionId && this.preConfiguredOutlookTokens) {
            tokens = this.preConfiguredOutlookTokens;
        } else {
            if (!sessionId) {
                throw new Error('Session ID is required when no pre-configured tokens are available.');
            }
    
            const tokenPath = this.getOutlookTokenPath(sessionId);
            if (!fs.existsSync(tokenPath)) {
                throw new Error('Outlook token not found for sessionId');
            }
    
            try {
                tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            } catch (err) {
                this.deleteOutlookUser(sessionId);
                throw new Error('Invalid Outlook token file, deleted. Please re-authenticate.');
            }
        }
    
        // Refresh if needed
        if (Date.now() >= tokens.expires_at) {
            try {
                tokens = await this.refreshOutlookToken(tokens, sessionId);
            } catch (error) {
                if (sessionId) {
                    this.deleteOutlookUser(sessionId);
                }
                throw new Error('Outlook token expired and refresh failed. Please re-authenticate.');
            }
        }
    
        return tokens.access_token;
    }
    
}