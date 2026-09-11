import { Module } from '@nestjs/common';
import { RespuestasExamenController } from './respuestas-examen.controller';
import { RendirController } from './rendir.controller';
import { RespuestasExamenService } from './respuestas-examen.service';

@Module({
  controllers: [RespuestasExamenController, RendirController],
  providers: [RespuestasExamenService],
})
export class RespuestasExamenModule {}
