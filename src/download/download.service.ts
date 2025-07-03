import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface DownloadSettings {
   useCustomPath: boolean;
   customPath: string;
}

interface SaveSettingsResult {
   success: boolean;
   settings?: DownloadSettings;
   error?: string;
}

interface PathValidationResult {
   valid: boolean;
   message?: string;
   normalizedPath?: string;
}

@Injectable()
export class DownloadService {
   private readonly SETTINGS_FILE: string;
   private readonly defaultSettings: DownloadSettings;

   constructor() {
       this.SETTINGS_FILE = path.join(__dirname, '../config/download-settings.json');
       this.defaultSettings = {
           useCustomPath: false,
           customPath: ''
       };
       
       this.initializeConfig();
   }

   private initializeConfig(): void {
       const configDir = path.dirname(this.SETTINGS_FILE);
       if (!fs.existsSync(configDir)) {
           fs.mkdirSync(configDir, { recursive: true });
       }
   }

   loadSettings(): DownloadSettings {
       try {
           if (fs.existsSync(this.SETTINGS_FILE)) {
               const data = fs.readFileSync(this.SETTINGS_FILE, 'utf8');
               return { ...this.defaultSettings, ...JSON.parse(data) };
           }
       } catch (error) {
           console.error('Failed to load download settings:', error);
       }
       return this.defaultSettings;
   }

   saveSettings(settings: Partial<DownloadSettings>): SaveSettingsResult {
       try {
           const mergedSettings = { ...this.defaultSettings, ...settings };
           fs.writeFileSync(this.SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2));
           return { success: true, settings: mergedSettings };
       } catch (error) {
           console.error('Failed to save download settings:', error);
           return { success: false, error: error.message };
       }
   }

   getDownloadPath(): string {
       const settings = this.loadSettings();
       if (settings.useCustomPath && settings.customPath) {
           return settings.customPath;
       }
       return path.join(__dirname, '../downloads');
   }

   ensureDirectory(dirPath: string): boolean {
       try {
           if (!fs.existsSync(dirPath)) {
               fs.mkdirSync(dirPath, { recursive: true });
           }
           return true;
       } catch (error) {
           console.error('Failed to create directory:', error);
           return false;
       }
   }

   validatePath(inputPath: string): PathValidationResult {
       try {
           if (!inputPath) {
               return { valid: false, message: 'Path is required' };
           }
           
           if (!path.isAbsolute(inputPath)) {
               return { valid: false, message: 'Please provide absolute path' };
           }
       
           const normalizedPath = path.normalize(inputPath);
           
           try {
               fs.accessSync(path.dirname(normalizedPath), fs.constants.W_OK);
           } catch (error) {
               return { valid: false, message: 'Directory is not writable' };
           }
           
           return { 
               valid: true, 
               normalizedPath: normalizedPath 
           };
       } catch (error) {
           return { valid: false, message: 'Invalid path format' };
       }
   }

   checkDuplicateFile(fileName: string): boolean {
        const downloadPath = this.getDownloadPath();
        const fullPath = path.join(downloadPath, fileName);
        return fs.existsSync(fullPath);
    }
}