import { Controller, Get, Param, Post } from '@nestjs/common';
import { ResumenCursoService } from './resumen-curso.service';

@Controller('trabajos-practicos/:trabajoPracticoId/resumen-curso')
export class ResumenCursoController {
  constructor(private readonly service: ResumenCursoService) {}

  @Post()
  generar(@Param('trabajoPracticoId') trabajoPracticoId: string) {
    return this.service.generar(trabajoPracticoId);
  }

  @Get()
  findUltimo(@Param('trabajoPracticoId') trabajoPracticoId: string) {
    return this.service.findUltimo(trabajoPracticoId);
  }
}
