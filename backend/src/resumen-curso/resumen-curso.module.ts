import { Module } from '@nestjs/common';
import { ResumenCursoController } from './resumen-curso.controller';
import { ResumenCursoService } from './resumen-curso.service';

@Module({
  controllers: [ResumenCursoController],
  providers: [ResumenCursoService],
})
export class ResumenCursoModule {}
