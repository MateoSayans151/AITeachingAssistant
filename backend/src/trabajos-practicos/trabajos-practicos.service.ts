import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrabajoPracticoDto } from './dto/create-trabajo-practico.dto';

@Injectable()
export class TrabajosPracticosService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTrabajoPracticoDto) {
    return this.prisma.trabajoPractico.create({
      data: {
        docenteId: dto.docenteId,
        titulo: dto.titulo,
        materia: dto.materia,
        consigna: dto.consigna,
        criterios: {
          create: dto.criterios.map((c, i) => ({
            nombre: c.nombre,
            descripcion: c.descripcion,
            puntajeMaximo: c.puntajeMaximo,
            orden: i,
          })),
        },
      },
      include: { criterios: true },
    });
  }

  findAll() {
    return this.prisma.trabajoPractico.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        criterios: true,
        _count: { select: { entregas: true } },
      },
    });
  }

  async findOne(id: string) {
    const tp = await this.prisma.trabajoPractico.findUnique({
      where: { id },
      include: {
        criterios: { orderBy: { orden: 'asc' } },
        entregas: {
          orderBy: { createdAt: 'asc' },
          include: { correccion: true },
        },
      },
    });
    if (!tp) throw new NotFoundException(`Trabajo práctico ${id} no encontrado`);
    return tp;
  }
}
