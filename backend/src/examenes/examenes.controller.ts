import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ExamenesService } from './examenes.service';
import { CreateExamenDto } from './dto/create-examen.dto';
import { UpdateExamenDto } from './dto/update-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { ActualizarPublicacionDto } from './dto/actualizar-publicacion.dto';
import { EnviarNotasDto } from './dto/enviar-notas.dto';
import { LiberarFeedbackDto } from './dto/liberar-feedback.dto';
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
    await this.sanearMatrices(docenteId, dto);
    return this.service.create(dto, docenteId);
  }

  // Una matriz de origen ajena no se puede referenciar (leería su contenido por el examen). Si un docente duplica, edita o rehace el
  // examen de un compañero, sus criterios traen la matriz PERSONAL de ese compañero como origen: el contenido ya está copiado en cada
  // criterio, así que el origen se descarta (queda como criterio suelto) en vez de rechazar todo el examen con 404.
  private async sanearMatrices(docenteId: string, dto: CreateExamenDto) {
    const matrizIds = [...new Set(dto.preguntas.flatMap((p) => (p.criterios ?? []).map((c) => c.matrizOrigenId)))];
    const propias = new Set<string>();
    for (const id of matrizIds) {
      if (!id) continue;
      try {
        await this.acceso.matriz(docenteId, id);
        propias.add(id);
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    for (const p of dto.preguntas) {
      for (const c of p.criterios ?? []) if (c.matrizOrigenId && !propias.has(c.matrizOrigenId)) c.matrizOrigenId = undefined;
    }
  }

  @Get()
  async findAllByCurso(@DocenteId() docenteId: string, @Query('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.findAllByCurso(cursoId);
  }

  // Antes de ':id' para que "pendientes" no se tome por un id. Es de la home: qué exámenes del docente esperan su revisión.
  @Get('pendientes')
  porRevisar(@DocenteId() docenteId: string) {
    return this.service.porRevisarDelDocente(docenteId);
  }

  @Get(':id')
  async findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.service.findOne(id);
  }

  // Título, consigna y feedback se pueden cambiar en cualquier momento, también con alumnos rindiendo: no tocan ninguna nota.
  @Patch(':id')
  async actualizarDatos(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: UpdateExamenDto) {
    await this.acceso.examen(docenteId, id);
    return this.service.actualizarDatos(id, dto);
  }

  // Reemplaza todo el contenido (preguntas, rúbricas, escala, modalidad...). Solo si nadie empezó ni entregó (si no, 409).
  @Put(':id')
  async reemplazarContenido(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: CreateExamenDto) {
    await this.acceso.examen(docenteId, id);
    await this.acceso.curso(docenteId, dto.cursoId);
    await this.sanearMatrices(docenteId, dto);
    return this.service.reemplazarContenido(id, dto);
  }

  // Cuántos alumnos empezaron o entregaron: lo que decide qué se puede editar y qué se pierde al borrar.
  @Get(':id/alumnos-que-rindieron')
  async alumnosQueRindieron(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.service.alumnosQueRindieron(id);
  }

  // Fechas de apertura y cierre de un link ya publicado (extender el plazo, por ejemplo).
  @Patch(':id/comisiones/:examenComisionId')
  async actualizarPublicacion(
    @DocenteId() docenteId: string,
    @Param('id') id: string,
    @Param('examenComisionId') examenComisionId: string,
    @Body() dto: ActualizarPublicacionDto,
  ) {
    await this.acceso.examen(docenteId, id);
    return this.service.actualizarPublicacion(id, examenComisionId, dto);
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
  async liberarFeedback(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto?: LiberarFeedbackDto) {
    await this.acceso.examen(docenteId, id);
    return this.service.liberarFeedback(id, dto?.respuestaIds);
  }

  // Cómo va el envío de las notas por mail: cuántos salieron, cuántos fallaron y por qué.
  @Get(':id/notificaciones')
  async resumenNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.notificaciones.resumen(id);
  }

  // Los alumnos a los que ya se les puede mandar el resultado, con quién ya lo recibió: la lista que el docente tilda.
  @Get(':id/notificaciones/destinatarios')
  async destinatariosNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.notificaciones.destinatarios(id);
  }

  // Manda el resultado solo a los elegidos (también a quienes ya lo recibieron, si se los tilda de nuevo).
  @Post(':id/notificaciones/enviar')
  async enviarNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto: EnviarNotasDto) {
    await this.acceso.examen(docenteId, id);
    return this.notificaciones.notificarSeleccion(id, dto.respuestaIds);
  }

  // Reintenta en segundo plano el mail de los alumnos que todavía no lo recibieron (los que fallaron o quedaron sin enviar).
  @Post(':id/notificaciones/reenviar')
  async reenviarNotificaciones(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    if (!this.notificaciones.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_REENVIAR);
    return this.notificaciones.notificarExamen(id);
  }
}
