import { Module } from '@nestjs/common';
import { CorreccionesController } from './correcciones.controller';
import { CorreccionesService } from './correcciones.service';

@Module({
  controllers: [CorreccionesController],
  providers: [CorreccionesService],
})
export class CorreccionesModule {}
