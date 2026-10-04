import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrabajoPracticoDto } from './dto/create-trabajo-practico.dto';
import { resolverConfigLink } from './config-link.util';

/** Dirección que se le manda al alumno. Los TP anteriores al link no tienen. */
function conUrlAcceso<T extends { slugAcceso: string | null }>(tp: T) {
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  return { ...tp, urlAcceso: tp.slugAcceso ? `${frontendOrigin}/entregar/${tp.slugAcceso}` : null };
}

@Injectable()
export class TrabajosPracticosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(docenteId: string, dto: CreateTrabajoPracticoDto) {
    const config = resolverConfigLink(dto);
    const tp = await this.prisma.trabajoPractico.create({
      data: {
        docenteId,
        titulo: dto.titulo,
        materia: dto.materia,
        consigna: dto.consigna,
        ...config,
        // 96 bits al azar: el link es el único "permiso" que tiene el alumno, tiene que ser imposible de adivinar.
        slugAcceso: randomBytes(12).toString('base64url'),
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
    return conUrlAcceso(tp);
  }

  findAll(docenteId: string) {
    return this.prisma.trabajoPractico.findMany({
      where: { docenteId },
      orderBy: { createdAt: 'desc' },
      include: {
        criterios: true,
        _count: { select: { entregas: true } },
      },
    });
  }

  async findOne(docenteId: string, id: string) {
    if (!isUUID(id)) throw new NotFoundException(`Trabajo práctico ${id} no encontrado`);
    const tp = await this.prisma.trabajoPractico.findFirst({
      where: { id, docenteId },
      include: {
        criterios: { orderBy: { orden: 'asc' } },
        entregas: {
          orderBy: { createdAt: 'asc' },
          include: {
            correccion: true,
            // Solo si entregó desde el link; son las señales del modo seguro para que el docente las pondere.
            intento: { select: { inicioEn: true, entregadoEn: true, estado: true, salidasPantalla: true, cambiosPestana: true, pegados: true } },
          },
        },
      },
    });
    if (!tp) throw new NotFoundException(`Trabajo práctico ${id} no encontrado`);
    return conUrlAcceso(tp);
  }
}
