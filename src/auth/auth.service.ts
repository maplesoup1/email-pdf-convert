import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface Credentials {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
}

interface TokenData {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expiry_date: number;
}

@Injectable()
export class AuthService {
    private credentials: Credentials;
    private tokensDir: string;
    private preConfiguredTokens: TokenData | null = null;

    constructor() {
        this.credentials = this.loadCredentials();
        this.tokensDir = path.join(process.cwd(), 'user_tokens');
        
        if (!fs.existsSync(this.tokensDir)) {
            fs.mkdirSync(this.tokensDir, { recursive: true });
        }

        this.loadPreConfiguredTokens();
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
            throw new Error('No credentials found. Please provide environment variables or credentials.json file.');
        }
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

    listAuthorizedUsers(): string[] {
        const users = fs.readdirSync(this.tokensDir)
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
        
        if (this.preConfiguredTokens) {
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

    hasPreConfiguredTokens(): boolean {
        return this.preConfiguredTokens !== null;
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
}