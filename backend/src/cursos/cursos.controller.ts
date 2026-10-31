import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CursosService } from './cursos.service';
import { CreateCursoDto } from './dto/create-curso.dto';
import { AgregarDocenteDto } from './dto/agregar-docente.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('cursos')
export class CursosController {
  constructor(
    private readonly service: CursosService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  create(@DocenteId() docenteId: string, @Body() dto: CreateCursoDto) {
    return this.service.create(docenteId, dto);
  }

  @Get()
  findAll(@DocenteId() docenteId: string) {
    return this.service.findAll(docenteId);
  }

  @Get(':id')
  findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    return this.service.findOne(docenteId, id);
  }

  // Equipo del curso. Cualquier docente del equipo puede verlo y modificarlo: todos tienen los mismos permisos.
  @Get(':id/docentes')
  async equipo(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.curso(docenteId, id);
    return this.service.equipo(id);
  }

  // Más estricto que el límite global: sin esto, el alta por email serviría para ir probando qué emails tienen cuenta.
  @Post(':id/docentes')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async agregarDocente(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: AgregarDocenteDto) {
    await this.acceso.curso(docenteId, id);
    return this.service.agregarDocente(id, docenteId, dto.email);
  }

  @Delete(':id/docentes/:docenteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async quitarDocente(@DocenteId() docenteId: string, @Param('id') id: string, @Param('docenteId') quitar: string) {
    await this.acceso.curso(docenteId, id);
    await this.service.quitarDocente(id, quitar);
  }

  @Delete(':id/invitaciones/:invitacionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async quitarInvitacion(@DocenteId() docenteId: string, @Param('id') id: string, @Param('invitacionId') invitacionId: string) {
    await this.acceso.curso(docenteId, id);
    await this.service.quitarInvitacion(id, invitacionId);
  }
}
