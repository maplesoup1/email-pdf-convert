import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

interface EmailInsert {
  subject: string;
  sender: string;
  received_at: Date;
  converted?: boolean;
  file_paths?: string[];
  gmail_id: string;
  thread_id: string;
}

interface FileUploadResult {
  url: string;
  path: string;
  fullPath: string;
}

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private readonly bucketName = 'email-pdfs';

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  async uploadPdf(
    filePath: string, 
    fileName: string, 
    folder: string = 'converted-emails'
  ): Promise<FileUploadResult> {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const safeFileName = this.sanitizeFileName(fileName);
      const storagePath = `${folder}/${safeFileName}`;
      
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (error) {
        throw new Error(`PDF upload failed: ${error.message}`);
      }

      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(storagePath);

      return {
        url: urlData.publicUrl,
        path: storagePath,
        fullPath: data.path
      };
    } catch (error) {
      throw new Error(`Failed to upload PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async uploadMultiplePdfs(
    filePaths: string[], 
    folder: string = 'converted-emails'
  ): Promise<FileUploadResult[]> {
    const results: FileUploadResult[] = [];
    
    for (const filePath of filePaths) {
      try {
        const fileName = path.basename(filePath);
        const result = await this.uploadPdf(filePath, fileName, folder);
        results.push(result);
      } catch (error) {
        console.error(`Failed to upload ${filePath}:`, error);
      }
    }
    
    return results;
  }

  async insertEmail(email: EmailInsert) {
    const { data, error } = await this.supabase
      .from('emails')
      .insert([{ ...email }])
      .select();

    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }

    return data;
  }

  sanitizeFileName(name: string): string {
    return name
      .normalize('NFKD') 
      .replace(/[^\w\-\.]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 100);
  }
  

  async markAsConverted(gmailId: string, filePaths: string[]) {
    const { error } = await this.supabase
      .from('emails')
      .update({ converted: true, file_paths: filePaths })
      .eq('gmail_id', gmailId);

    if (error) {
      throw new Error(`Supabase update failed: ${error.message}`);
    }
  }

  async findEmailByGmailId(gmailId: string) {
    const { data, error } = await this.supabase
      .from('emails')
      .select('*')
      .eq('gmail_id', gmailId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Supabase select failed: ${error.message}`);
    }

    return data;
  }
}