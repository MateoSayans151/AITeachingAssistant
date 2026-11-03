import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AccesoService } from '../acceso/acceso.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCursoDto } from './dto/create-curso.dto';
import { UpdateCursoDto } from './dto/update-curso.dto';
import { coincideNombre, MENSAJE_CONFIRMACION_NO_COINCIDE } from '../examenes/confirmar-nombre.util';
import { RESUMEN_VACIO, resumenesDeExamenes } from '../examenes/resumen-respuestas.util';

export const MENSAJE_CURSO_CON_OTROS_DOCENTES =
  'Este curso lo comparten otros docentes: no se puede eliminar para no sacárselo. Podés salir del curso y lo siguen usando ellos.';

export const MENSAJE_ULTIMO_DOCENTE = 'El curso tiene que quedar con al menos un docente.';

/** Lo que se muestra de cada docente del equipo (nunca el hash de contraseña ni el id de Supabase). */
const DOCENTE_PUBLICO = { id: true, nombre: true, email: true } as const;

/**
 * Cursos y su equipo docente. Un curso lo comparten varios docentes, todos con los mismos permisos (ver, armar y corregir exámenes,
 * cargar material, manejar comisiones y sumar o sacar docentes): ver AccesoService. Esta clase solo se ocupa de listarlos y de
 * armar el equipo; quién puede llamar a cada método lo decide el controller con `AccesoService.curso`.
 */
@Injectable()
export class CursosService {
  constructor(private readonly prisma: PrismaService) {}

  /** El curso nace con su creador como único miembro del equipo. */
  create(docenteId: string, dto: CreateCursoDto) {
    return this.prisma.curso.create({ data: { ...dto, docenteId, equipo: { create: { docenteId, agregadoPor: docenteId } } } });
  }

  /** Cambia el nombre y la materia. Cualquiera del equipo puede (lo chequea el controller). */
  async actualizar(id: string, dto: UpdateCursoDto) {
    if (!isUUID(id)) throw new NotFoundException(`Curso ${id} no encontrado`);
    const data: { nombre?: string; materia?: string | null } = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.materia !== undefined) data.materia = dto.materia === '' ? null : dto.materia;
    if (Object.keys(data).length === 0) throw new BadRequestException('No hay nada para cambiar.');
    const { count } = await this.prisma.curso.updateMany({ where: { id }, data });
    if (count === 0) throw new NotFoundException(`Curso ${id} no encontrado`);
    return this.prisma.curso.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Las reglas para eliminar un curso (sin borrar nada): solo puede quien es el ÚLTIMO docente del equipo (si hay más, lo que
   * corresponde es salir del curso) y tiene que escribir el nombre del curso. Devuelve cuánto se pierde, para avisarlo.
   */
  async validarEliminacion(cursoId: string, docenteId: string, confirmacion: string) {
    if (!isUUID(cursoId)) throw new NotFoundException(`Curso ${cursoId} no encontrado`);
    const curso = await this.prisma.curso.findUnique({
      where: { id: cursoId },
      select: { nombre: true, equipo: { select: { docenteId: true } } },
    });
    if (!curso) throw new NotFoundException(`Curso ${cursoId} no encontrado`);
    if (curso.equipo.length !== 1 || curso.equipo[0].docenteId !== docenteId) throw new ConflictException(MENSAJE_CURSO_CON_OTROS_DOCENTES);
    if (!coincideNombre(confirmacion, curso.nombre)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
  }

  /** Lo que se pierde al eliminar el curso (el aviso del diálogo): exámenes, alumnos que rindieron, comisiones y materiales. */
  async queSePierde(cursoId: string) {
    const [examenes, comisiones, materiales, respuestas] = await Promise.all([
      this.prisma.examen.count({ where: { cursoId } }),
      this.prisma.comision.count({ where: { cursoId } }),
      this.prisma.materialCurso.count({ where: { cursoId } }),
      this.prisma.respuestaExamen.count({ where: { examen: { cursoId } } }),
    ]);
    return { examenes, comisiones, materiales, respuestas };
  }

  /**
   * Elimina el curso con todo lo que cuelga de él (comisiones, alumnos, exámenes, respuestas, material y su índice RAG, por
   * cascada). Las reglas se vuelven a chequear dentro de la transacción: si entró otro docente mientras tanto, no se borra.
   */
  async eliminar(cursoId: string, docenteId: string, confirmacion: string) {
    if (!isUUID(cursoId)) throw new NotFoundException(`Curso ${cursoId} no encontrado`);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cursos WHERE id = ${cursoId}::uuid FOR UPDATE`;
      const curso = await tx.curso.findUnique({ where: { id: cursoId }, select: { nombre: true, equipo: { select: { docenteId: true } } } });
      if (!curso) throw new NotFoundException(`Curso ${cursoId} no encontrado`);
      if (curso.equipo.length !== 1 || curso.equipo[0].docenteId !== docenteId) throw new ConflictException(MENSAJE_CURSO_CON_OTROS_DOCENTES);
      if (!coincideNombre(confirmacion, curso.nombre)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
      await tx.curso.delete({ where: { id: cursoId } });
    });
  }

  findAll(docenteId: string) {
    return this.prisma.curso.findMany({
      where: AccesoService.delEquipo(docenteId),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comisiones: true, examenes: true, equipo: true } },
        // Lo mínimo para que «Primeros pasos» sepa hasta dónde llegó el docente.
        examenes: { select: { estado: true, feedbackLiberadoEn: true } },
      },
    });
  }

  async findOne(docenteId: string, id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Curso ${id} no encontrado`);
    const curso = await this.prisma.curso.findFirst({
      where: { id, ...AccesoService.delEquipo(docenteId) },
      include: {
        comisiones: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { alumnos: true } } },
        },
        examenes: { orderBy: { createdAt: 'desc' }, include: { creadoPor: { select: { id: true, nombre: true } } } },
        materiales: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!curso) throw new NotFoundException(`Curso ${id} no encontrado`);
    // Cada examen con cuántas respuestas tiene y cuántas esperan al docente: la lista del curso lo muestra sin entrar a cada uno.
    const resumenes = await resumenesDeExamenes(this.prisma, curso.examenes.map((e) => e.id));
    return { ...curso, examenes: curso.examenes.map((e) => ({ ...e, resumenRespuestas: resumenes.get(e.id) ?? RESUMEN_VACIO })) };
  }

  // ---------------------------------------------------------------- equipo

  /** Los docentes del curso (el más antiguo primero) y los invitados que todavía no tienen cuenta. */
  async equipo(cursoId: string) {
    const [miembros, invitaciones] = await Promise.all([
      this.prisma.cursoDocente.findMany({
        where: { cursoId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, docente: { select: DOCENTE_PUBLICO } },
      }),
      this.prisma.cursoInvitacion.findMany({ where: { cursoId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, createdAt: true } }),
    ]);
    return {
      docentes: miembros.map((m) => ({ ...m.docente, desde: m.createdAt })),
      invitaciones,
    };
  }

  /**
   * Suma al equipo al docente con ese email. Si ya tiene cuenta entra en el acto; si no, queda una invitación y entra solo cuando se
   * registre con ese email (ver SesionDocenteService). Es idempotente: repetirlo no duplica ni falla.
   * Ojo: la respuesta distingue "agregado" de "invitado", así que cualquier docente puede saber si un email tiene cuenta. Es una
   * herramienta interna entre docentes de una misma cátedra y hace falta para que la pantalla le diga al docente qué pasó.
   */
  async agregarDocente(cursoId: string, quienAgrega: string, email: string) {
    const docente = await this.prisma.docente.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: DOCENTE_PUBLICO });
    if (docente) {
      await this.prisma.$transaction([
        this.prisma.cursoDocente.upsert({
          where: { cursoId_docenteId: { cursoId, docenteId: docente.id } },
          create: { cursoId, docenteId: docente.id, agregadoPor: quienAgrega },
          update: {},
        }),
        // Si lo habían invitado antes de que se registrara, la invitación ya no hace falta.
        this.prisma.cursoInvitacion.deleteMany({ where: { cursoId, email } }),
      ]);
      return { estado: 'agregado' as const, docente };
    }
    await this.prisma.cursoInvitacion.upsert({
      where: { cursoId_email: { cursoId, email } },
      create: { cursoId, email, invitadoPor: quienAgrega },
      update: {},
    });
    return { estado: 'invitado' as const, email };
  }

  /**
   * Saca a un docente del equipo (también sirve para que uno "salga" del curso). El curso no puede quedar sin docentes. Si el que se
   * va es quien lo creó, el "docente de referencia" (el que firma los mails a los alumnos) pasa al miembro más antiguo que queda.
   */
  async quitarDocente(cursoId: string, docenteId: string) {
    if (!isUUID(docenteId)) throw new NotFoundException('Docente no encontrado en el curso');
    await this.prisma.$transaction(async (tx) => {
      const miembros = await tx.cursoDocente.findMany({ where: { cursoId }, orderBy: { createdAt: 'asc' }, select: { docenteId: true } });
      if (!miembros.some((m) => m.docenteId === docenteId)) throw new NotFoundException('Docente no encontrado en el curso');
      if (miembros.length <= 1) throw new ConflictException(MENSAJE_ULTIMO_DOCENTE);
      await tx.cursoDocente.delete({ where: { cursoId_docenteId: { cursoId, docenteId } } });
      const curso = await tx.curso.findUniqueOrThrow({ where: { id: cursoId }, select: { docenteId: true } });
      if (curso.docenteId === docenteId) {
        const siguiente = miembros.find((m) => m.docenteId !== docenteId)!;
        await tx.curso.update({ where: { id: cursoId }, data: { docenteId: siguiente.docenteId } });
      }
    });
  }

  async quitarInvitacion(cursoId: string, invitacionId: string) {
    if (!isUUID(invitacionId)) throw new NotFoundException('Invitación no encontrada');
    const r = await this.prisma.cursoInvitacion.deleteMany({ where: { id: invitacionId, cursoId } });
    if (r.count === 0) throw new NotFoundException('Invitación no encontrada');
  }
}
