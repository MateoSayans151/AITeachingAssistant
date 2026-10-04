import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// ConfigModule es global (app.module.ts), así que MailService ya recibe el ConfigService sin importarlo acá.
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
