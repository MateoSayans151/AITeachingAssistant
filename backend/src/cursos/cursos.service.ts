import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AccesoService } from '../acceso/acceso.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCursoDto } from './dto/create-curso.dto';
import { RESUMEN_VACIO, resumenesDeExamenes } from '../examenes/resumen-respuestas.util';

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

  findAll(docenteId: string) {
    return this.prisma.curso.findMany({
      where: AccesoService.delEquipo(docenteId),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comisiones: true, examenes: true, equipo: true } },
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
