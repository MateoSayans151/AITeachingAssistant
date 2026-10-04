import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { validarNivelesDescripcionMatriz } from '../examenes/niveles.util';
import { CreateMatrizRubricaDto } from './dto/create-matriz-rubrica.dto';

@Injectable()
export class MatricesRubricaService {
  constructor(private readonly prisma: PrismaService) {}

  async create(docenteId: string, dto: CreateMatrizRubricaDto) {
    // Los niveles detallados son opcionales; si vienen, entre 3 y 7 numerados 1..K sin saltos ni repetidos (lo que no se puede
    // con decorators). Su cantidad no depende de ninguna escala: la matriz se reutiliza entre exámenes.
    for (const c of dto.criterios) {
      const error = validarNivelesDescripcionMatriz(c.nombre, c.nivelesDescripcion);
      if (error) throw new BadRequestException(error);
    }

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
            // La columna es Json no nula: sin niveles detallados se guarda [] (los consumidores ya lo toleran).
            nivelesDescripcion: (c.nivelesDescripcion ?? []) as unknown as Prisma.InputJsonValue,
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
