import { Module } from '@nestjs/common';
import { ComisionesController, ComisionDetalleController, AlumnosController } from './comisiones.controller';
import { ComisionesService } from './comisiones.service';

@Module({
  controllers: [ComisionesController, ComisionDetalleController, AlumnosController],
  providers: [ComisionesService],
  exports: [ComisionesService],
})
export class ComisionesModule {}
