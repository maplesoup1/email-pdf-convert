import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { PdfRule } from '../emails/emails.entity';

interface EmailInsert {
  subject: string;
  sender: string;
  receivedAt: Date;
  filePaths?: { type: string; path: string }[];
  gmailId: string;
  threadId: string;
  pdfRule?: PdfRule;
  convertedRules?: { [rule: string]: RuleConversionData };
}

interface FileUploadResult {
  url: string;
  path: string;
  fullPath: string;
  fileName: string;
}

export interface RuleConversionData {
  filenames?: string[];
  filePaths?: string[];
  error?: string;
  updatedAt: string;
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
      fullPath: data.path,
      fileName: safeFileName
    };
  }

  async uploadMultiplePdfs(
    filePaths: string[], 
    folder: string = 'converted-emails',
    originalFileNames?: string[]
  ): Promise<FileUploadResult[]> {
    const results: FileUploadResult[] = [];
    
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const fileName = originalFileNames ? originalFileNames[i] : path.basename(filePath);
      const result = await this.uploadPdf(filePath, fileName, folder);
      results.push(result);
    }
    
    return results;
  }

  async insertEmail(email: EmailInsert) {
    const { data, error } = await this.supabase
      .from('emails')
      .insert([{
        subject: email.subject,
        sender: email.sender,
        received_at: email.receivedAt,
        file_paths: email.filePaths || [],
        gmail_id: email.gmailId,
        thread_id: email.threadId,
        pdf_rule: email.pdfRule,
        converted_rules: email.convertedRules || {}
      }])
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

  async markAsConverted(
    gmailId: string, 
    filePaths: { type: string; path: string }[], 
    pdfRule: PdfRule
  ) {
    const { error } = await this.supabase
      .from('emails')
      .update({ 
        file_paths: filePaths,
        pdf_rule: pdfRule 
      })
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

  async markRuleAsConverted(
    gmailId: string,
    pdfRule: PdfRule,
    ruleData: RuleConversionData
  ): Promise<void> {
    console.log('=== markRuleAsConverted START ===');
    console.log('Gmail ID:', gmailId);
    console.log('PDF Rule:', pdfRule);
    console.log('Rule Data:', ruleData);
  
    const { data: existingEmail } = await this.supabase
      .from('emails')
      .select('converted_rules')
      .eq('gmail_id', gmailId)
      .single();
  
    console.log('Existing email data:', existingEmail);
  
    if (existingEmail) {
      console.log('Existing converted_rules:', existingEmail.converted_rules);
      
      const updatedRules = {
        ...existingEmail.converted_rules,
        [pdfRule]: ruleData
      };
      
      console.log('Updated rules (before save):', updatedRules);
  
      const { error } = await this.supabase
        .from('emails')
        .update({
          converted_rules: updatedRules,
          pdf_rule: pdfRule
        })
        .eq('gmail_id', gmailId);
  
      if (error) {
        console.log('Update error:', error);
        throw new Error(`Failed to update convertedRules: ${error.message}`);
      }
      
      console.log('Successfully updated converted_rules');
    } else {
      console.log('No existing email found for Gmail ID:', gmailId);
    }
    
    console.log('=== markRuleAsConverted END ===');
  }

  async isRuleProcessed(gmailId: string, pdfRule: PdfRule): Promise<boolean> {
    const { data: email } = await this.supabase
      .from('emails')
      .select('converted_rules')
      .eq('gmail_id', gmailId)
      .single();

    if (!email) return false;

    const ruleData = email.converted_rules?.[pdfRule];
    return ruleData?.converted === true && ruleData.filePaths?.length > 0;
  }

  async getConvertedRules(gmailId: string): Promise<{ [rule: string]: RuleConversionData } | null> {
    const { data: email } = await this.supabase
      .from('emails')
      .select('converted_rules')
      .eq('gmail_id', gmailId)
      .single();

    return email?.converted_rules || null;
  }

  async getRuleFiles(gmailId: string, pdfRule: PdfRule): Promise<string[]> {
    const { data: email } = await this.supabase
      .from('emails')
      .select('converted_rules')
      .eq('gmail_id', gmailId)
      .single();

    if (!email) return [];

    const ruleData = email.converted_rules?.[pdfRule];
    return ruleData?.filePaths || [];
  }

  async getEmailProcessingStatus(gmailId: string): Promise<{
    gmailId: string;
    totalRules: number;
    processedRules: number;
    failedRules: number;
    ruleStatus: { [rule: string]: { processed: boolean; failed: boolean; filePaths?: string[] } };
  }> {
    const { data: email } = await this.supabase
      .from('emails')
      .select('converted_rules')
      .eq('gmail_id', gmailId)
      .single();

    if (!email) {
      return {
        gmailId,
        totalRules: 0,
        processedRules: 0,
        failedRules: 0,
        ruleStatus: {}
      };
    }

    const convertedRules = email.converted_rules || {};
    const allRules = Object.values(PdfRule);
    
    let processedCount = 0;
    let failedCount = 0;
    const ruleStatus: { [rule: string]: { processed: boolean; failed: boolean; filePaths?: string[] } } = {};

    for (const rule of allRules) {
      const ruleData = convertedRules[rule];
      const processed = ruleData?.converted === true;
      const failed = ruleData?.converted === false && ruleData.error;

      ruleStatus[rule] = {
        processed,
        failed: !!failed,
        filePaths: ruleData?.filePaths
      };

      if (processed) processedCount++;
      if (failed) failedCount++;
    }

    return {
      gmailId,
      totalRules: allRules.length,
      processedRules: processedCount,
      failedRules: failedCount,
      ruleStatus
    };
  }
}