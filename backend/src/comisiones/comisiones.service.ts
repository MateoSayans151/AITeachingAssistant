import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComisionDto, AlumnoInputDto } from './dto/create-comision.dto';
import { coincideNombre, MENSAJE_CONFIRMACION_NO_COINCIDE } from '../examenes/confirmar-nombre.util';

/** Código para rendir (72 bits): se le entrega al alumno junto con el link de la comisión. */
export const generarCodigoAcceso = () => randomBytes(9).toString('base64url');

/** Emails siempre sin espacios y en minúsculas: así el match al rendir no depende de cómo se cargó. */
export const normalizarEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class ComisionesService {
  constructor(private readonly prisma: PrismaService) {}

  create(cursoId: string, dto: CreateComisionDto) {
    return this.prisma.comision.create({
      data: {
        cursoId,
        nombre: dto.nombre,
        alumnos: dto.alumnos
          ? { create: dto.alumnos.map((a) => ({ nombre: a.nombre, email: normalizarEmail(a.email), codigoAcceso: generarCodigoAcceso() })) }
          : undefined,
      },
      include: { alumnos: true },
    });
  }

  findAllByCurso(cursoId: string) {
    return this.prisma.comision.findMany({
      where: { cursoId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { alumnos: true } } },
    });
  }

  async findOne(id: string) {
    const comision = await this.prisma.comision.findUnique({
      where: { id },
      include: { alumnos: { orderBy: { nombre: 'asc' } } },
    });
    if (!comision) throw new NotFoundException(`Comisión ${id} no encontrada`);
    return comision;
  }

  /** Lo que se pierde al eliminar la comisión (el aviso del diálogo): sus alumnos, los links publicados y las respuestas de esos alumnos. */
  async queSePierde(comisionId: string) {
    if (!isUUID(comisionId)) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);
    const [alumnos, publicaciones, respuestas, rindiendo] = await Promise.all([
      this.prisma.alumno.count({ where: { comisionId } }),
      this.prisma.examenComision.count({ where: { comisionId } }),
      this.prisma.respuestaExamen.count({ where: { alumno: { comisionId } } }),
      this.prisma.intentoExamen.count({ where: { estado: 'en_curso', alumno: { comisionId } } }),
    ]);
    return { alumnos, publicaciones, respuestas, rindiendo };
  }

  /** Antes de borrar nada de afuera de la base (imágenes): ¿el nombre escrito es el de la comisión? 404 si no existe, 400 si no coincide. */
  async validarEliminacion(comisionId: string, confirmacion: string) {
    if (!isUUID(comisionId)) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);
    const comision = await this.prisma.comision.findUnique({ where: { id: comisionId }, select: { nombre: true } });
    if (!comision) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);
    if (!coincideNombre(confirmacion, comision.nombre)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
  }

  /**
   * Elimina la comisión con todo lo que cuelga de ella, por cascada: sus alumnos, los links publicados (dejan de funcionar), y los
   * intentos, respuestas, notas y eventos de esos alumnos. El nombre se vuelve a validar dentro de la transacción, con la fila bloqueada.
   */
  async eliminar(comisionId: string, confirmacion: string) {
    if (!isUUID(comisionId)) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM comisiones WHERE id = ${comisionId}::uuid FOR UPDATE`;
      const comision = await tx.comision.findUnique({ where: { id: comisionId }, select: { nombre: true } });
      if (!comision) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);
      if (!coincideNombre(confirmacion, comision.nombre)) throw new BadRequestException(MENSAJE_CONFIRMACION_NO_COINCIDE);
      await tx.comision.delete({ where: { id: comisionId } });
    });
  }

  async agregarAlumno(comisionId: string, dto: AlumnoInputDto) {
    const comision = await this.prisma.comision.findUnique({ where: { id: comisionId } });
    if (!comision) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);

    return this.prisma.alumno.create({
      data: { comisionId, nombre: dto.nombre, email: normalizarEmail(dto.email), codigoAcceso: generarCodigoAcceso() },
    });
  }
}
