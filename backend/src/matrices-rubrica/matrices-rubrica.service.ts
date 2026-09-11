import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMatrizRubricaDto } from './dto/create-matriz-rubrica.dto';

@Injectable()
export class MatricesRubricaService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateMatrizRubricaDto) {
    return this.prisma.matrizRubrica.create({
      data: {
        docenteId: dto.docenteId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        criterios: {
          create: dto.criterios.map((c, i) => ({
            nombre: c.nombre,
            descripcion: c.descripcion,
            puntajeMaximo: c.puntajeMaximo,
            nivelesDescripcion: c.nivelesDescripcion as unknown as Prisma.InputJsonValue,
            orden: i,
          })),
        },
      },
      include: { criterios: { orderBy: { orden: 'asc' } } },
    });
  }

  // Igual que TrabajosPracticosService.findAll(): no se filtra por docente en este MVP.
  findAll() {
    return this.prisma.matrizRubrica.findMany({
      orderBy: { createdAt: 'desc' },
      include: { criterios: { orderBy: { orden: 'asc' } } },
    });
  }

  async findOne(id: string) {
    const matriz = await this.prisma.matrizRubrica.findUnique({
      where: { id },
      include: { criterios: { orderBy: { orden: 'asc' } } },
    });
    if (!matriz) throw new NotFoundException(`Matriz de rúbrica ${id} no encontrada`);
    return matriz;
  }
}
