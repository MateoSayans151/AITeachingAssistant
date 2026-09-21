import { Module } from '@nestjs/common';
import { MaterialesCursoController, MaterialDetalleController } from './materiales-curso.controller';
import { MaterialesCursoService } from './materiales-curso.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [MaterialesCursoController, MaterialDetalleController],
  providers: [MaterialesCursoService],
  exports: [MaterialesCursoService],
})
export class MaterialesCursoModule {}
