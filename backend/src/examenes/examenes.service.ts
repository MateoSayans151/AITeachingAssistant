import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { conCriterioGeneral } from './criterio-general.util';
import { AccesoService } from '../acceso/acceso.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamenDto, TIPOS_AUTOCORREGIBLES } from './dto/create-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { validarNivelesDescripcionCriterio } from './niveles.util';
import { validarNivelesEscala, validarPuntajes } from './puntaje.util';
import { RESUMEN_VACIO, examenesPorRevisar, resumenesDeExamenes } from './resumen-respuestas.util';
import { MENSAJE_SIN_MAIL_PARA_PUBLICAR, NotificacionesService } from '../mail/notificaciones.service';

export const MENSAJE_EXAMEN_CON_ALUMNOS =
  'Este examen ya tiene alumnos que empezaron o entregaron: no se puede borrar para no perder sus respuestas.';

@Injectable()
export class ExamenesService {
  private readonly logger = new Logger(ExamenesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  create(dto: CreateExamenDto, creadoPorId?: string) {
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
        antiCheat: dto.antiCheat && Object.values(dto.antiCheat).some(Boolean) ? (dto.antiCheat as unknown as Prisma.InputJsonValue) : undefined,
        preguntas: {
          create: dto.preguntas.map((p, i) => ({
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
          })),
        },
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
   * Borra el examen solo si NADIE empezó ni entregó (ni respuestas ni intentos): si no, se perderían las respuestas de los
   * alumnos. Las preguntas, criterios, publicaciones a comisiones (los links dejan de funcionar) y ajustes de vara se van
   * por cascada en la base.
   * Todo en una transacción y con la fila del examen bloqueada (FOR UPDATE): un alumno que está por empezar (su intento
   * toma un lock de la fila del examen por la clave foránea) espera a que terminemos, y entonces o ve que el examen ya no
   * está o lo contamos nosotros y se rechaza el borrado. Sin el lock podría empezar justo entre el conteo y el borrado y
   * perder lo que acaba de escribir por la cascada.
   */
  async remove(id: string) {
    // Un id que no es UUID no puede existir (y el cast del SQL de abajo respondería 500).
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM examenes WHERE id = ${id}::uuid FOR UPDATE`;
      if (filas.length === 0) throw new NotFoundException(`Examen ${id} no encontrado`);
      const respuestas = await tx.respuestaExamen.count({ where: { examenId: id } });
      const intentos = await tx.intentoExamen.count({ where: { examenId: id } });
      if (respuestas > 0 || intentos > 0) throw new ConflictException(MENSAJE_EXAMEN_CON_ALUMNOS);
      await tx.examen.delete({ where: { id } });
    });
  }

  /** Cambia el título del examen. Devuelve solo lo que cambió (id y título). */
  async renombrar(id: string, titulo: string) {
    if (!isUUID(id)) throw new NotFoundException(`Examen ${id} no encontrado`);
    const { count } = await this.prisma.examen.updateMany({ where: { id }, data: { titulo } });
    if (count === 0) throw new NotFoundException(`Examen ${id} no encontrado`);
    return { id, titulo };
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
  async liberarFeedback(examenId: string) {
    if (!this.notificaciones.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_PUBLICAR);

    await this.prisma.examen.updateMany({
      where: { id: examenId, feedbackLiberadoEn: null },
      data: { feedbackLiberadoEn: new Date() },
    });
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    const pendientesDeRevision = await this.prisma.respuestaExamen.count({ where: { examenId, estadoRevision: 'pendiente' } });
    // Las notas ya quedaron publicadas: si el arranque del envío falla no se deshace nada, se reintenta con "reenviar".
    const { aEnviar } = await this.notificaciones.notificarExamen(examenId).catch((err) => {
      this.logger.error(`No se pudo iniciar el envío de mails del examen ${examenId}`, err as Error);
      return { aEnviar: 0 };
    });
    return { ...examen, pendientesDeRevision, aEnviar };
  }
}
