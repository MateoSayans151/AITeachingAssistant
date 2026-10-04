import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComisionDto, AlumnoInputDto } from './dto/create-comision.dto';

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

  async agregarAlumno(comisionId: string, dto: AlumnoInputDto) {
    const comision = await this.prisma.comision.findUnique({ where: { id: comisionId } });
    if (!comision) throw new NotFoundException(`Comisión ${comisionId} no encontrada`);

    return this.prisma.alumno.create({
      data: { comisionId, nombre: dto.nombre, email: normalizarEmail(dto.email), codigoAcceso: generarCodigoAcceso() },
    });
  }
}
