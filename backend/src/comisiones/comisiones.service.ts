import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComisionDto, AlumnoInputDto } from './dto/create-comision.dto';

@Injectable()
export class ComisionesService {
  constructor(private readonly prisma: PrismaService) {}

  create(cursoId: string, dto: CreateComisionDto) {
    return this.prisma.comision.create({
      data: {
        cursoId,
        nombre: dto.nombre,
        alumnos: dto.alumnos ? { create: dto.alumnos } : undefined,
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
      data: { comisionId, nombre: dto.nombre, email: dto.email },
    });
  }
}
