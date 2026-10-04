import { Controller, Get, Param, Post } from '@nestjs/common';
import { ResumenCursoService } from './resumen-curso.service';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('trabajos-practicos/:trabajoPracticoId/resumen-curso')
export class ResumenCursoController {
  constructor(
    private readonly service: ResumenCursoService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  async generar(@DocenteId() docenteId: string, @Param('trabajoPracticoId') trabajoPracticoId: string) {
    await this.acceso.trabajoPractico(docenteId, trabajoPracticoId);
    return this.service.generar(trabajoPracticoId);
  }

  @Get()
  async findUltimo(@DocenteId() docenteId: string, @Param('trabajoPracticoId') trabajoPracticoId: string) {
    await this.acceso.trabajoPractico(docenteId, trabajoPracticoId);
    return this.service.findUltimo(trabajoPracticoId);
  }
}
