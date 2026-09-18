import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCursoDto } from './dto/create-curso.dto';

@Injectable()
export class CursosService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCursoDto) {
    return this.prisma.curso.create({ data: dto });
  }

  // Igual que TrabajosPracticosService.findAll(): no se filtra por docente en este MVP.
  findAll() {
    return this.prisma.curso.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comisiones: true, examenes: true } },
      },
    });
  }

  async findOne(id: string) {
    const curso = await this.prisma.curso.findUnique({
      where: { id },
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
