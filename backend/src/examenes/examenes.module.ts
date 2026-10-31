import { Module } from '@nestjs/common';
import { ExamenesController } from './examenes.controller';
import { SugerenciasController } from './sugerencias.controller';
import { SugerenciasPreguntasController } from './sugerencias-preguntas.controller';
import { SugerenciaPreguntasService } from './sugerencia-preguntas.service';
import { RagModule } from '../rag/rag.module';
import { ExamenesService } from './examenes.service';
import { VaraService } from './vara.service';
import { NotificacionesModule } from '../mail/notificaciones.module';

@Module({
  imports: [NotificacionesModule, RagModule],
  controllers: [ExamenesController, SugerenciasController, SugerenciasPreguntasController],
  providers: [ExamenesService, VaraService, SugerenciaPreguntasService],
  exports: [ExamenesService, VaraService],
})
export class ExamenesModule {}
