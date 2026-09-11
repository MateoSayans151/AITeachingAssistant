import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamenDto, TIPOS_AUTOCORREGIBLES } from './dto/create-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { AplicarVaraDto } from './dto/aplicar-vara.dto';

@Injectable()
export class ExamenesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExamenDto) {
    // Regla de negocio (no expresable con decorators porque depende del tipo de pregunta):
    // las preguntas cerradas necesitan `opciones` (con la clave correcta) y las abiertas
    // necesitan `criterios` (matriz de niveles). Nunca las dos, nunca ninguna.
    for (const [i, p] of dto.preguntas.entries()) {
      const esAutocorregible = TIPOS_AUTOCORREGIBLES.includes(p.tipo);
      if (esAutocorregible && !p.opciones) {
        throw new BadRequestException(`La pregunta ${i + 1} (${p.tipo}) necesita "opciones" con la clave correcta`);
      }
      if (!esAutocorregible && (!p.criterios || p.criterios.length === 0)) {
        throw new BadRequestException(`La pregunta ${i + 1} (${p.tipo}) necesita al menos un criterio de rúbrica`);
      }
    }

    return this.prisma.examen.create({
      data: {
        cursoId: dto.cursoId,
        titulo: dto.titulo,
        consigna: dto.consigna,
        modalidad: dto.modalidad,
        duracionMinutos: dto.duracionMinutos,
        escalaMin: dto.escalaMin,
        escalaMax: dto.escalaMax,
        niveles: dto.niveles as unknown as Prisma.InputJsonValue,
        feedbackModo: dto.feedbackModo,
        preguntas: {
          create: dto.preguntas.map((p, i) => ({
            tipo: p.tipo,
            enunciado: p.enunciado,
            puntajeMaximo: p.puntajeMaximo,
            opciones: p.opciones ? (p.opciones as unknown as Prisma.InputJsonValue) : undefined,
            orden: i,
            criterios: p.criterios
              ? {
                  create: p.criterios.map((c, j) => ({
                    matrizOrigenId: c.matrizOrigenId,
                    nombre: c.nombre,
                    descripcion: c.descripcion,
                    puntajeMaximo: c.puntajeMaximo,
                    nivelesDescripcion: c.nivelesDescripcion as unknown as Prisma.InputJsonValue,
                    orden: j,
                  })),
                }
              : undefined,
          })),
        },
      },
      include: { preguntas: { include: { criterios: true }, orderBy: { orden: 'asc' } } },
    });
  }

  findAllByCurso(cursoId: string) {
    return this.prisma.examen.findMany({
      where: { cursoId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { preguntas: true, respuestas: true } } },
    });
  }

  async findOne(id: string) {
    const examen = await this.prisma.examen.findUnique({
      where: { id },
      include: {
        preguntas: { orderBy: { orden: 'asc' }, include: { criterios: { orderBy: { orden: 'asc' } } } },
        comisiones: { include: { comision: true } },
      },
    });
    if (!examen) throw new NotFoundException(`Examen ${id} no encontrado`);
    return examen;
  }

  async publicarAComision(examenId: string, dto: PublicarComisionDto) {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    const comision = await this.prisma.comision.findUnique({ where: { id: dto.comisionId } });
    if (!comision) throw new NotFoundException(`Comisión ${dto.comisionId} no encontrada`);

    const [examenComision] = await this.prisma.$transaction([
      this.prisma.examenComision.create({
        data: {
          examenId,
          comisionId: dto.comisionId,
          slugAcceso: randomUUID(),
          fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : undefined,
          fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : undefined,
        },
      }),
      this.prisma.examen.update({ where: { id: examenId }, data: { estado: 'publicado' } }),
    ]);

    const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
    return { ...examenComision, urlAcceso: `${frontendOrigin}/rendir/${examenComision.slugAcceso}` };
  }

  /**
   * Aplica la "vara": desplaza en `varaPorcentaje` la nota sugerida por la IA y la deja
   * como nota final sugerida. Solo toca las respuestas que el docente todavía NO revisó
   * individualmente (estadoRevision === 'pendiente') — una vez que el docente edita a mano
   * la nota de un alumno puntual, la vara no se la pisa.
   */
  async aplicarVara(examenId: string, dto: AplicarVaraDto) {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    const respuestas = await this.prisma.respuestaExamen.findMany({
      where: { examenId, estadoRevision: 'pendiente', notaTotalSugerida: { not: null } },
    });

    const escalaMin = Number(examen.escalaMin);
    const escalaMax = Number(examen.escalaMax);

    await this.prisma.$transaction([
      this.prisma.examen.update({ where: { id: examenId }, data: { varaPorcentaje: dto.varaPorcentaje } }),
      ...respuestas.map((r) => {
        const notaConVara = Number(r.notaTotalSugerida) * (1 + dto.varaPorcentaje / 100);
        const notaClamp = Math.min(Math.max(notaConVara, escalaMin), escalaMax);
        return this.prisma.respuestaExamen.update({
          where: { id: r.id },
          data: { notaTotalFinal: notaClamp },
        });
      }),
    ]);

    return this.prisma.respuestaExamen.findMany({
      where: { examenId },
      include: { alumno: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async liberarFeedback(examenId: string) {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    return this.prisma.examen.update({
      where: { id: examenId },
      data: { feedbackLiberadoEn: new Date() },
    });
  }
}
