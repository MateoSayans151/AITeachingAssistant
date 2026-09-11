import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ComisionesService } from './comisiones.service';
import { CreateComisionDto, AlumnoInputDto } from './dto/create-comision.dto';

@Controller('cursos/:cursoId/comisiones')
export class ComisionesController {
  constructor(private readonly service: ComisionesService) {}

  @Post()
  create(@Param('cursoId') cursoId: string, @Body() dto: CreateComisionDto) {
    return this.service.create(cursoId, dto);
  }

  @Get()
  findAllByCurso(@Param('cursoId') cursoId: string) {
    return this.service.findAllByCurso(cursoId);
  }
}

@Controller('comisiones')
export class ComisionDetalleController {
  constructor(private readonly service: ComisionesService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}

@Controller('comisiones/:comisionId/alumnos')
export class AlumnosController {
  constructor(private readonly service: ComisionesService) {}

  @Post()
  agregarAlumno(@Param('comisionId') comisionId: string, @Body() dto: AlumnoInputDto) {
    return this.service.agregarAlumno(comisionId, dto);
  }
}
