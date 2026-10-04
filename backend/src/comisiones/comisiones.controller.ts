import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ComisionesService } from './comisiones.service';
import { CreateComisionDto, AlumnoInputDto } from './dto/create-comision.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('cursos/:cursoId/comisiones')
export class ComisionesController {
  constructor(
    private readonly service: ComisionesService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  async create(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string, @Body() dto: CreateComisionDto) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.create(cursoId, dto);
  }

  @Get()
  async findAllByCurso(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.findAllByCurso(cursoId);
  }
}

@Controller('comisiones')
export class ComisionDetalleController {
  constructor(
    private readonly service: ComisionesService,
    private readonly acceso: AccesoService,
  ) {}

  @Get(':id')
  async findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.comision(docenteId, id);
    return this.service.findOne(id);
  }
}

@Controller('comisiones/:comisionId/alumnos')
export class AlumnosController {
  constructor(
    private readonly service: ComisionesService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  async agregarAlumno(@DocenteId() docenteId: string, @Param('comisionId') comisionId: string, @Body() dto: AlumnoInputDto) {
    await this.acceso.comision(docenteId, comisionId);
    return this.service.agregarAlumno(comisionId, dto);
  }
}
