import { Module } from '@nestjs/common';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [EmailsController],
  providers: [EmailsService],
  exports: [EmailsService], 
})
export class EmailsModule {}