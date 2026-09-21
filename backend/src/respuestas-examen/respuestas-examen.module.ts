import { Module } from '@nestjs/common';
import { RespuestasExamenController } from './respuestas-examen.controller';
import { RendirController } from './rendir.controller';
import { RespuestasExamenService } from './respuestas-examen.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [RespuestasExamenController, RendirController],
  providers: [RespuestasExamenService],
})
export class RespuestasExamenModule {}
