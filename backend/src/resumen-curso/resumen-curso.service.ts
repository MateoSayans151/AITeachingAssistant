import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ResumenCursoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * Corre el prompt "agregado": toma todas las correcciones ya revisadas de un TP
   * y le pide a la IA que identifique qué criterios/conceptos generaron más dificultad.
   * Pensado para ejecutarse una vez que el docente terminó de revisar todas las entregas.
   */
  async generar(trabajoPracticoId: string) {
    const tp = await this.prisma.trabajoPractico.findUnique({
      where: { id: trabajoPracticoId },
      include: {
        criterios: true,
        entregas: { include: { correccion: true } },
      },
    });
    if (!tp) throw new NotFoundException(`Trabajo práctico ${trabajoPracticoId} no encontrado`);

    const correccionesListas = tp.entregas
      .map((e) => e.correccion)
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (correccionesListas.length === 0) {
      throw new BadRequestException('Todavía no hay entregas corregidas para este trabajo práctico');
    }

    const resultado = await this.ai.generarResumenCurso({
      consigna: tp.consigna,
      criterios: tp.criterios.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        descripcion: c.descripcion,
        puntajeMaximo: Number(c.puntajeMaximo),
      })),
      correcciones: correccionesListas.map((c) => ({
        notaPorCriterio: c.notaPorCriterio,
        feedbackFinal: c.feedbackFinal,
        feedbackSugerido: c.feedbackSugerido,
      })),
    });

    const contenidoMarkdown = [
      resultado.resumenGeneral,
      '',
      '**Patrones detectados:**',
      ...resultado.patronesDetectados.map(
        (p) => `- **${p.criterioOConcepto}** (${p.cantidadAlumnosAfectados} alumnos): ${p.descripcion}`,
      ),
    ].join('\n');

    return this.prisma.resumenCurso.create({
      data: {
        trabajoPracticoId,
        contenido: contenidoMarkdown,
        cantidadEntregasAnalizadas: correccionesListas.length,
        modeloIa: this.ai.modeloActivo,
      },
    });
  }

  findUltimo(trabajoPracticoId: string) {
    return this.prisma.resumenCurso.findFirst({
      where: { trabajoPracticoId },
      orderBy: { generadoEn: 'desc' },
    });
  }
}
