import { Module } from '@nestjs/common';
import { ExamenesController } from './examenes.controller';
import { ExamenesService } from './examenes.service';

@Module({
  controllers: [ExamenesController],
  providers: [ExamenesService],
  exports: [ExamenesService],
})
export class ExamenesModule {}
