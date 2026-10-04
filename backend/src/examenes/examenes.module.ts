import { Module } from '@nestjs/common';
import { ExamenesController } from './examenes.controller';
import { ExamenesService } from './examenes.service';
import { VaraService } from './vara.service';
import { NotificacionesModule } from '../mail/notificaciones.module';

@Module({
  imports: [NotificacionesModule],
  controllers: [ExamenesController],
  providers: [ExamenesService, VaraService],
  exports: [ExamenesService, VaraService],
})
export class ExamenesModule {}
