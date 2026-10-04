import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ExamenesService } from './examenes.service';
import { CreateExamenDto } from './dto/create-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { ReglaVaraDto } from './dto/vara.dto';
import { VaraService } from './vara.service';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { MENSAJE_SIN_MAIL_PARA_REENVIAR, NotificacionesService } from '../mail/notificaciones.service';

@Controller('examenes')
export class ExamenesController {
  constructor(
    private readonly service: ExamenesService,
    private readonly vara: VaraService,
    private readonly acceso: AccesoService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  @Post()
  async create(@DocenteId() docenteId: string, @Body() dto: CreateExamenDto) {
    await this.acceso.curso(docenteId, dto.cursoId);
    // Una matriz de origen ajena no se puede referenciar (leería su contenido por el examen).
    const matrizIds = [...new Set(dto.preguntas.flatMap((p) => (p.criterios ?? []).map((c) => c.matrizOrigenId)))];
    for (const id of matrizIds) if (id) await this.acceso.matriz(docenteId, id);
    return this.service.create(dto);
  }

  @Get()
  async findAllByCurso(@DocenteId() docenteId: string, @Query('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.findAllByCurso(cursoId);
  }

  @Get(':id')
  async findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.service.findOne(id);
  }

  // Solo si nadie empezó ni entregó (si no, 409): preguntas, criterios, links y ajustes de vara se van con el examen.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    await this.service.remove(id);
  }

  @Post(':id/comisiones')
  async publicarAComision(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: PublicarComisionDto) {
    await this.acceso.examen(docenteId, id);
    await this.acceso.comision(docenteId, dto.comisionId);
    return this.service.publicarAComision(id, dto);
  }

  // Vara: regla explícita y auditable. Nunca pisa la nota sugerida ni escribe la final.
  @Post(':id/vara/preview')
  async previewVara(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: ReglaVaraDto) {
    await this.acceso.examen(docenteId, id);
    return this.vara.preview(id, dto);
  }

  @Post(':id/vara')
  async aplicarVara(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: ReglaVaraDto) {
    await this.acceso.examen(docenteId, id);
    return this.vara.aplicar(id, docenteId, dto);
  }

  @Get(':id/vara')
  async historialVara(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.vara.historial(id);
  }

  @Post(':id/vara/:ajusteId/revertir')
  async revertirVara(@DocenteId() docenteId: string, @Param('id') id: string, @Param('ajusteId') ajusteId: string) {
    await this.acceso.examen(docenteId, id);
    return this.vara.revertir(id, ajusteId);
  }

  @Post(':id/liberar-feedback')
  async liberarFeedback(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.service.liberarFeedback(id);
  }

  // Cómo va el envío de las notas por mail: cuántos salieron, cuántos fallaron y por qué.
  @Get(':id/notificaciones')
  async resumenNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.notificaciones.resumen(id);
  }

  // Reintenta en segundo plano el mail de los alumnos que todavía no lo recibieron (los que fallaron o quedaron sin enviar).
  @Post(':id/notificaciones/reenviar')
  async reenviarNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    if (!this.notificaciones.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_REENVIAR);
    return this.notificaciones.notificarExamen(id);
  }
}
