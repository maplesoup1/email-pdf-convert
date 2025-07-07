import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum PdfRule {
  MAIN_BODY_WITH_ATTACHMENT = 'mainbodywithattachment',
  MAIN_BODY_SEPARATE_ATTACHMENT = 'mainbody_separate_attachment',
  ATTACHMENT_ONLY = 'attachment_only',
}

@Entity('emails')
export class Email {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  subject: string;

  @Column()
  sender: string;

  @Column({ type: 'timestamptz', name: 'received_at' })
  receivedAt: Date;

  @Column({ nullable: true, name: 'pdf_url' })
  pdfUrl: string;

  @Column({
    type: 'enum',
    enum: PdfRule,
    nullable: true,
    name: 'pdf_rule'
  })
  pdfRule: PdfRule;
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ unique: true, name: 'gmail_id' })
  gmailId: string;

  @Column({ name: 'thread_id' })
  threadId: string;

  @Column({ type: 'jsonb', nullable: true, name: 'file_paths' })
  filePaths: {
    type: string;
    path: string;
  }[];

  @Column({ type: 'jsonb', default: {}, name: 'converted_rules' })
  convertedRules: {
    [rule: string]: {
      converted: boolean;
      filenames?: string[];
      filePaths?: string[];
      error?: string;
      updatedAt: string;
    };
  };
}