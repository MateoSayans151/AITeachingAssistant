import { Module } from '@nestjs/common';
import { MaterialesCursoController, MaterialDetalleController } from './materiales-curso.controller';
import { MaterialesCursoService } from './materiales-curso.service';

@Module({
  controllers: [MaterialesCursoController, MaterialDetalleController],
  providers: [MaterialesCursoService],
  exports: [MaterialesCursoService],
})
export class MaterialesCursoModule {}
