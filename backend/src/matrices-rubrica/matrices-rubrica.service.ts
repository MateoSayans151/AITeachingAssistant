import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMatrizRubricaDto } from './dto/create-matriz-rubrica.dto';

@Injectable()
export class MatricesRubricaService {
  constructor(private readonly prisma: PrismaService) {}

  create(docenteId: string, dto: CreateMatrizRubricaDto) {
    return this.prisma.matrizRubrica.create({
      data: {
        docenteId,
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

  findAll(docenteId: string) {
    return this.prisma.matrizRubrica.findMany({
      where: { docenteId },
      orderBy: { createdAt: 'desc' },
      include: { criterios: { orderBy: { orden: 'asc' } } },
    });
  }

  async findOne(docenteId: string, id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Matriz de rúbrica ${id} no encontrado`);
    const matriz = await this.prisma.matrizRubrica.findFirst({
      where: { id, docenteId },
      include: { criterios: { orderBy: { orden: 'asc' } } },
    });
    if (!matriz) throw new NotFoundException(`Matriz de rúbrica ${id} no encontrada`);
    return matriz;
  }
}
