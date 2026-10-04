import { Module } from '@nestjs/common';
import { ExamenesController } from './examenes.controller';
import { ExamenesService } from './examenes.service';
import { VaraService } from './vara.service';

@Module({
  controllers: [ExamenesController],
  providers: [ExamenesService, VaraService],
  exports: [ExamenesService, VaraService],
})
export class ExamenesModule {}
