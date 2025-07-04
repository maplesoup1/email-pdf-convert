// src/emails/emails.entity.ts
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

  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ default: false })
  converted: boolean;

  @Column({ nullable: true })
  pdfUrl: string;

  @Column({
    type: 'enum',
    enum: PdfRule,
    nullable: true,
  })
  pdfRule: PdfRule;
  
  @CreateDateColumn()
  createdAt: Date;

  @Column({ unique: true })
  gmailId: string;

  @Column()
  threadId: string;

  @Column({ type: 'jsonb', nullable: true })
  filePaths: {
    type: string;
    path: string;
  }[];
}
