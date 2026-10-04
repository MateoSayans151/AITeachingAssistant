import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCursoDto } from './dto/create-curso.dto';

@Injectable()
export class CursosService {
  constructor(private readonly prisma: PrismaService) {}

  create(docenteId: string, dto: CreateCursoDto) {
    return this.prisma.curso.create({ data: { ...dto, docenteId } });
  }

  findAll(docenteId: string) {
    return this.prisma.curso.findMany({
      where: { docenteId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comisiones: true, examenes: true } },
      },
    });
  }

  async findOne(docenteId: string, id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Curso ${id} no encontrado`);
    const curso = await this.prisma.curso.findFirst({
      where: { id, docenteId },
      include: {
        comisiones: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { alumnos: true } } },
        },
        examenes: { orderBy: { createdAt: 'desc' } },
        materiales: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!curso) throw new NotFoundException(`Curso ${id} no encontrado`);
    return curso;
  }
}
