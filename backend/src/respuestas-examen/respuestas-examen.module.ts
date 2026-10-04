import { Module } from '@nestjs/common';
import { RespuestasExamenController } from './respuestas-examen.controller';
import { RendirController } from './rendir.controller';
import { RespuestasExamenService } from './respuestas-examen.service';
import { IntentosService } from './intentos.service';
import { RagModule } from '../rag/rag.module';
import { ExamenesModule } from '../examenes/examenes.module';

@Module({
  imports: [RagModule, ExamenesModule],
  controllers: [RespuestasExamenController, RendirController],
  providers: [RespuestasExamenService, IntentosService],
})
export class RespuestasExamenModule {}
