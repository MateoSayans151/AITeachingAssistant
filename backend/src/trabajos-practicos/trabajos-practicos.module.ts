import { Module } from '@nestjs/common';
import { TrabajosPracticosController } from './trabajos-practicos.controller';
import { EntregarController } from './entregar.controller';
import { TrabajosPracticosService } from './trabajos-practicos.service';
import { IntentosTpService } from './intentos-tp.service';
import { EntregasModule } from '../entregas/entregas.module';

@Module({
  imports: [EntregasModule],
  controllers: [TrabajosPracticosController, EntregarController],
  providers: [TrabajosPracticosService, IntentosTpService],
  exports: [TrabajosPracticosService],
})
export class TrabajosPracticosModule {}
