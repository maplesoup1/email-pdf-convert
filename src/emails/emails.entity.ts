// src/emails/emails.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

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
