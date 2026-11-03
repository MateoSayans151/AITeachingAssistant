import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { conCriterioGeneral } from './criterio-general.util';
import { AccesoService } from '../acceso/acceso.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamenDto, TIPOS_AUTOCORREGIBLES } from './dto/create-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { ActualizarPublicacionDto } from './dto/actualizar-publicacion.dto';
import { UpdateExamenDto } from './dto/update-examen.dto';
import { coincideNombre, MENSAJE_CONFIRMACION_NO_COINCIDE } from './confirmar-nombre.util';
import { validarNivelesDescripcionCriterio } from './niveles.util';
import { validarNivelesEscala, validarPuntajes } from './puntaje.util';
import { RESUMEN_VACIO, examenesPorRevisar, resumenesDeExamenes } from './resumen-respuestas.util';
import { MENSAJE_SIN_MAIL_PARA_PUBLICAR, NotificacionesService } from '../mail/notificaciones.service';

export const MENSAJE_EXAMEN_CON_ALUMNOS =
  'Este examen ya tiene alumnos que empezaron o entregaron: no se pueden cambiar sus preguntas para no descuadrar las notas. Duplicalo para armar una versión nueva.';

@Injectable()
export class ExamenesService {
  private readonly logger = new Logger(ExamenesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** Las reglas de negocio de un examen completo (las comparten crear y editar). Puede reemplazar `dto.preguntas` (criterio general). */
  private validar(dto: CreateExamenDto) {
    // Regla de negocio (no expresable con decorators porque depende del tipo de pregunta): las preguntas cerradas necesitan
    // `opciones` (con la clave correcta). Las abiertas pueden traer `criterios` (matriz de niveles) o no: sin criterios se guardan
    // con un único criterio general que vale todos sus puntos (ver criterio-general.util.ts).
    for (const [i, p] of dto.preguntas.entries()) {
      if (TIPOS_AUTOCORREGIBLES.includes(p.tipo) && !p.opciones) {
        throw new BadRequestException(`La pregunta ${i + 1} (${p.tipo}) necesita "opciones" con la clave correcta`);
      }
    }
    dto.preguntas = conCriterioGeneral(dto.preguntas);

    if (dto.escalaMin >= dto.escalaMax) throw new BadRequestException('La escala mínima tiene que ser menor que la máxima');
    const dist = dto.distribucionEsperada;
    if (dist && (dist.umbralAprobacion < dto.escalaMin || dist.umbralAprobacion > dto.escalaMax)) {
      throw new BadRequestException('La nota de aprobación tiene que estar dentro de la escala');
    }

    // La escala tiene entre 3 y 7 niveles numerados 1..N, y tiene que poder dar el puntaje completo y crecer (si no, el total
    // del examen no se alcanzaría nunca).
    const errorNiveles = validarNivelesEscala(dto.niveles);
    if (errorNiveles) throw new BadRequestException(errorNiveles);

    // Un criterio describe todos los niveles de la escala de ESTE examen o ninguno (no se puede con decorators: depende de dos campos).
    const cantidadNiveles = dto.niveles.length;
    for (const p of dto.preguntas) {
      for (const c of p.criterios ?? []) {
        const errorCriterio = validarNivelesDescripcionCriterio(c.nombre, c.nivelesDescripcion, cantidadNiveles);
        if (errorCriterio) throw new BadRequestException(errorCriterio);
      }
    }

    // El puntaje total tiene que ser igual a la escala máxima (si no, la nota de un alumno se pasaría de la escala) y
    // cada pregunta abierta vale la suma de sus criterios.
    const errorPuntaje = validarPuntajes(dto.preguntas, dto.escalaMax);
    if (errorPuntaje) throw new BadRequestException(errorPuntaje);
  }

  private preguntasParaCrear(dto: CreateExamenDto) {
    return dto.preguntas.map((p, i) => ({
      tipo: p.tipo,
      enunciado: p.enunciado,
      puntajeMaximo: p.puntajeMaximo,
      opciones: p.opciones ? (p.opciones as unknown as Prisma.InputJsonValue) : undefined,
      orden: i,
      criterios: p.criterios
        ? {
            create: p.criterios.map((c, j) => ({
              matrizOrigenId: c.matrizOrigenId,
              nombre: c.nombre,
              descripcion: c.descripcion,
              puntajeMaximo: c.puntajeMaximo,
              nivelesDescripcion: (c.nivelesDescripcion ?? []) as unknown as Prisma.InputJsonValue, // [] = sin niveles detallados
              orden: j,
            })),
          }
        : undefined,
    }));
  }

  private antiCheatParaGuardar(dto: CreateExamenDto) {
    return dto.antiCheat && Object.values(dto.antiCheat).some(Boolean) ? (dto.antiCheat as unknown as Prisma.InputJsonValue) : undefined;
  }

  create(dto: CreateExamenDto, creadoPorId?: string) {
    this.validar(dto);
    const dist = dto.distribucionEsperada;

    return this.prisma.examen.create({
      data: {
        cursoId: dto.cursoId,
        creadoPorId,
        titulo: dto.titulo,
        consigna: dto.consigna,
        modalidad: dto.modalidad,
        duracionMinutos: dto.duracionMinutos,
        escalaMin: dto.escalaMin,
        escalaMax: dto.escalaMax,
        niveles: dto.niveles as unknown as Prisma.InputJsonValue,
        feedbackModo: dto.feedbackModo,
        distribucionEsperada: dist ? (dist as unknown as Prisma.InputJsonValue) : undefined,
        antiCheat: this.antiCheatParaGuardar(dto),
        preguntas: { create: this.preguntasParaCrear(dto) },
      },
      include: { preguntas: { include: { criterios: true }, orderBy: { orden: 'asc' } } },
    });
  }

  /** La lista de exámenes de un curso, cada uno con cuántas respuestas hay y cuántas esperan al docente (`resumenRespuestas`). */
  async findAllByCurso(cursoId: string) {
    const examenes = await this.prisma.examen.findMany({
      where: { cursoId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { preguntas: true, respuestas: true } }, creadoPor: { select: { id: true, nombre: true } } },
    });
    const resumenes = await resumenesDeExamenes(this.prisma, examenes.map((e) => e.id));
    return examenes.map((e) => ({ ...e, resumenRespuestas: resumenes.get(e.id) ?? RESUMEN_VACIO }));
  }

  /** Los exámenes de los cursos del docente (los suyos y los que comparte con su equipo) que tienen respuestas por revisar o sin corregir: lo que muestra la home en "Para revisar". */
  async porRevisarDelDocente(docenteId: string) {
    const examenes = await this.prisma.examen.findMany({
      where: { curso: AccesoService.delEquipo(docenteId) },
      select: { id: true, titulo: true, cursoId: true, curso: { select: { nombre: true } } },
    });
    return examenesPorRevisar(examenes, await resumenesDeExamenes(this.prisma, examenes.map((e) => e.id)));
  }

  async findOne(id: string) {
    const examen = await this.prisma.examen.findUnique({
      where: { id },
      include: {
        preguntas: { orderBy: { orden: 'asc' }, include: { criterios: { orderBy: { orden: 'asc' } } } },
        comisiones: { include: { comision: true } },
        creadoPor: { select: { id: true, nombre: true } },
        // Cuántos alumnos empezaron o entregaron: la pantalla lo usa para saber si el examen se puede borrar.
        _count: { select: { respuestas: true, intentos: true } },
      },
    });
    if (!examen) throw new NotFoundException(`Examen ${id} no encontrado`);
    return examen;
  }

  /**
   * Borra el examen con todo lo que cuelga de él: preguntas, criterios, publicaciones (los links dejan de funcionar), intentos,
   * respuestas con sus notas, eventos de integridad y ajustes de vara, por cascada en la base. Por eso exige que el docente
   * escriba el nombre del examen: un clic sin querer no alcanza. (Las imágenes de las capturas no cuelgan de la base: las borra
   * quien llama, antes, ver ControlExamenController.)
   * Todo en una transacción y con la fila del examen bloqueada (FOR UPDATE): un alumno que está por empezar (su intento
   * toma un lock de la fila del examen por la clave foránea) espera a que terminemos y no escribe algo que la cascada borre
   * sin que lo veamos.
   */
  async remove(id: string, confirmacion: string) {
    // Un id que no es UUID no puede existir (y el cast del SQL de abajo respondería 500).
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<Array<{ id: string; titulo: string }>>`SELECT id, titulo FROM examenes WHERE id = ${id}::uuid FOR UPDATE`;
      if (filas.length === 0) throw new NotFoundException(`Examen ${id} no encontrado`);
      if (!coincideNombre(confirmacion, filas[0].titulo)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
      await tx.examen.delete({ where: { id } });
    });
  }

  /** Antes de borrar nada de afuera de la base (imágenes): ¿el nombre escrito es el del examen? 404 si no existe, 400 si no coincide. */
  async validarConfirmacion(id: string, confirmacion: string) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    const examen = await this.prisma.examen.findUnique({ where: { id }, select: { titulo: true } });
    if (!examen) throw new NotFoundException(`Examen ${id} no encontrado`);
    if (!coincideNombre(confirmacion, examen.titulo)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
  }

  /** Cuántos alumnos empezaron o entregaron el examen (lo que se pierde al borrarlo y lo que impide cambiar sus preguntas). */
  async alumnosQueRindieron(examenId: string) {
    const [intentos, respuestas] = await Promise.all([
      this.prisma.intentoExamen.count({ where: { examenId } }),
      this.prisma.respuestaExamen.count({ where: { examenId } }),
    ]);
    return { intentos, respuestas, empezaron: Math.max(intentos, respuestas) };
  }

  /**
   * Cambia los datos de un examen que ya existe y que se pueden tocar con alumnos rindiendo, porque no cambian ninguna nota ya
   * dada: el título, la consigna y cuándo se libera el feedback. Devuelve solo lo que cambió.
   */
  async actualizarDatos(id: string, dto: UpdateExamenDto) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    const data: Prisma.ExamenUpdateManyMutationInput = { titulo: dto.titulo };
    if (dto.consigna !== undefined) data.consigna = dto.consigna;
    if (dto.feedbackModo !== undefined) data.feedbackModo = dto.feedbackModo;
    const { count } = await this.prisma.examen.updateMany({ where: { id }, data });
    if (count === 0) throw new NotFoundException(`Examen ${id} no encontrado`);
    return { id, ...data };
  }

  /**
   * Reemplaza todo el contenido del examen (preguntas, puntos, rúbricas, escala, modalidad...). Solo se puede si NADIE empezó ni
   * entregó: con alumnos adentro, cambiar las preguntas dejaría notas ya dadas que no corresponden a lo que se preguntó (para eso
   * está "Duplicar y editar"). Las publicaciones y los links no se tocan. Mismo bloqueo de fila que `remove`.
   */
  async reemplazarContenido(id: string, dto: CreateExamenDto) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    this.validar(dto);
    const dist = dto.distribucionEsperada;
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<Array<{ id: string; curso_id: string }>>`SELECT id, curso_id FROM examenes WHERE id = ${id}::uuid FOR UPDATE`;
      if (filas.length === 0) throw new NotFoundException(`Examen ${id} no encontrado`);
      if (filas[0].curso_id !== dto.cursoId) throw new BadRequestException('Un examen no se puede pasar a otro curso: duplicalo en ese curso.');
      const [intentos, respuestas] = await Promise.all([tx.intentoExamen.count({ where: { examenId: id } }), tx.respuestaExamen.count({ where: { examenId: id } })]);
      if (intentos > 0 || respuestas > 0) throw new ConflictException(MENSAJE_EXAMEN_CON_ALUMNOS);
      await tx.pregunta.deleteMany({ where: { examenId: id } });
      return tx.examen.update({
        where: { id },
        data: {
          titulo: dto.titulo,
          consigna: dto.consigna,
          modalidad: dto.modalidad,
          duracionMinutos: dto.duracionMinutos ?? null,
          escalaMin: dto.escalaMin,
          escalaMax: dto.escalaMax,
          niveles: dto.niveles as unknown as Prisma.InputJsonValue,
          feedbackModo: dto.feedbackModo,
          distribucionEsperada: dist ? (dist as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          antiCheat: this.antiCheatParaGuardar(dto) ?? Prisma.DbNull,
          preguntas: { create: this.preguntasParaCrear(dto) },
        },
        include: { preguntas: { include: { criterios: true }, orderBy: { orden: 'asc' } } },
      });
    });
  }

  /**
   * Cierra el examen: los links dejan de aceptar alumnos nuevos. Qué pasa con los que están rindiendo lo decide quien llama
   * (ver IntentosService.entregarEnCurso). Cerrar uno ya cerrado es un 409.
   */
  async cerrar(id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    const { count } = await this.prisma.examen.updateMany({ where: { id, estado: { not: 'cerrado' } }, data: { estado: 'cerrado' } });
    if (count === 0) {
      const existe = await this.prisma.examen.count({ where: { id } });
      if (!existe) throw new NotFoundException(`Examen ${id} no encontrado`);
      throw new ConflictException('El examen ya está cerrado.');
    }
    return { id, estado: 'cerrado' as const };
  }

  /** Vuelve a abrir un examen cerrado: queda publicado si tiene links, o en borrador si nunca se publicó. */
  async reabrir(id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    const examen = await this.prisma.examen.findUnique({ where: { id }, select: { estado: true, _count: { select: { comisiones: true } } } });
    if (!examen) throw new NotFoundException(`Examen ${id} no encontrado`);
    if (examen.estado !== 'cerrado') throw new ConflictException('El examen no está cerrado.');
    const estado = examen._count.comisiones > 0 ? ('publicado' as const) : ('borrador' as const);
    // Se quita también el cierre programado: si ya pasó, el barrido lo volvería a cerrar al instante.
    await this.prisma.examen.update({ where: { id }, data: { estado, cierreProgramadoEn: null } });
    return { id, estado };
  }

  /** Cambia las fechas de una publicación (el link). No toca a quienes ya empezaron: su tiempo se fijó al iniciar. */
  async actualizarPublicacion(examenId: string, examenComisionId: string, dto: ActualizarPublicacionDto) {
    if (!isUUID(examenComisionId)) throw new NotFoundException('Publicación no encontrada');
    const actual = await this.prisma.examenComision.findFirst({ where: { id: examenComisionId, examenId }, select: { fechaInicio: true, fechaFin: true } });
    if (!actual) throw new NotFoundException('Publicación no encontrada');
    const aFecha = (v: string | null | undefined, previa: Date | null) => (v === undefined ? previa : v ? new Date(v) : null);
    const fechaInicio = aFecha(dto.fechaInicio, actual.fechaInicio);
    const fechaFin = aFecha(dto.fechaFin, actual.fechaFin);
    if (fechaInicio && fechaFin && fechaInicio >= fechaFin) throw new BadRequestException('La fecha de cierre tiene que ser posterior a la de apertura.');
    await this.prisma.examenComision.update({ where: { id: examenComisionId }, data: { fechaInicio, fechaFin } });
    return { id: examenComisionId, fechaInicio, fechaFin };
  }

  async publicarAComision(examenId: string, dto: PublicarComisionDto) {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    const comision = await this.prisma.comision.findUnique({ where: { id: dto.comisionId } });
    if (!comision) throw new NotFoundException(`Comisión ${dto.comisionId} no encontrada`);

    const [examenComision] = await this.prisma.$transaction([
      this.prisma.examenComision.create({
        data: {
          examenId,
          comisionId: dto.comisionId,
          slugAcceso: randomUUID(),
          fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : undefined,
          fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : undefined,
          // Por defecto cualquier alumno con el link puede entrar: el docente no tiene que cargar mails antes.
          accesoAbierto: dto.accesoAbierto ?? true,
          verificarEmail: dto.verificarEmail ?? false,
          dominioPermitido: dto.dominioPermitido || null,
        },
      }),
      this.prisma.examen.update({ where: { id: examenId }, data: { estado: 'publicado' } }),
    ]);

    const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
    return { ...examenComision, urlAcceso: `${frontendOrigin}/rendir/${examenComision.slugAcceso}` };
  }

  /**
   * Publica las notas del examen y manda por mail su resultado a cada alumno que ya tiene el examen revisado (el resto lo
   * recibe apenas el docente lo revise). Idempotente: solo escribe si todavía no estaban liberadas (así, aunque el
   * docente toque el botón dos veces o lleguen dos pedidos a la vez, se conserva la fecha original); volver a publicar
   * reintenta el envío a los que faltan.
   * Sin el envío de mails configurado se rechaza ANTES de marcar nada: si no, el examen quedaría "publicado" sin que
   * le llegue nada a nadie. El envío corre en segundo plano; la respuesta trae cuántos mails se lanzaron (`aEnviar`)
   * y cuántas respuestas siguen sin revisar, para que la pantalla pueda avisarlo.
   */
  async liberarFeedback(examenId: string, respuestaIds?: string[]) {
    if (!this.notificaciones.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_PUBLICAR);

    await this.prisma.examen.updateMany({
      where: { id: examenId, feedbackLiberadoEn: null },
      data: { feedbackLiberadoEn: new Date() },
    });
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    const pendientesDeRevision = await this.prisma.respuestaExamen.count({ where: { examenId, estadoRevision: 'pendiente' } });
    // Las notas ya quedaron publicadas: si el arranque del envío falla no se deshace nada, se reintenta con "reenviar".
    // Con una selección (lo que manda la pantalla) solo reciben el mail los elegidos; sin ella, todos los que ya están revisados.
    const envio = respuestaIds === undefined ? this.notificaciones.notificarExamen(examenId) : this.notificaciones.notificarSeleccionAlPublicar(examenId, respuestaIds);
    const { aEnviar } = await envio.catch((err) => {
      this.logger.error(`No se pudo iniciar el envío de mails del examen ${examenId}`, err as Error);
      return { aEnviar: 0 };
    });
    return { ...examen, pendientesDeRevision, aEnviar };
  }
}
