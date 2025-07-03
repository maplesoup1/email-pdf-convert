// src/supabase/supabase.service.ts
import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
  }

  async insertEmail(email: {
    subject: string;
    sender: string;
    received_at?: Date;
    converted?: boolean;
    pdf_url?: string;
  }) {
    const { data, error } = await this.supabase
      .from('emails')
      .insert([{ ...email }]);

    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }

    return data;
  }

  async markAsConverted(id: string, pdfUrl: string) {
    const { error } = await this.supabase
      .from('emails')
      .update({ converted: true, pdf_url: pdfUrl })
      .eq('id', id);

    if (error) {
      throw new Error(`Supabase update failed: ${error.message}`);
    }
  }
}
