import { Module } from '@nestjs/common';
import { TrabajosPracticosController } from './trabajos-practicos.controller';
import { TrabajosPracticosService } from './trabajos-practicos.service';

@Module({
  controllers: [TrabajosPracticosController],
  providers: [TrabajosPracticosService],
  exports: [TrabajosPracticosService],
})
export class TrabajosPracticosModule {}
