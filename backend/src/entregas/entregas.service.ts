import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';

@Injectable()
export class EntregasService {
  private readonly logger = new Logger(EntregasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async create(dto: CreateEntregaDto) {
    const trabajoPractico = await this.prisma.trabajoPractico.findUnique({
      where: { id: dto.trabajoPracticoId },
      include: { criterios: true },
    });
    if (!trabajoPractico) {
      throw new NotFoundException(`Trabajo práctico ${dto.trabajoPracticoId} no encontrado`);
    }

    const entrega = await this.prisma.entrega.create({
      data: {
        trabajoPracticoId: dto.trabajoPracticoId,
        alumnoNombre: dto.alumnoNombre,
        alumnoEmail: dto.alumnoEmail,
        textoTrabajo: dto.textoTrabajo,
      },
    });

    // Se corrige sincrónicamente para simplificar el MVP.
    // En v2, si el volumen crece, esto pasa a una cola (p. ej. Supabase Edge Function / job en background).
    try {
      await this.corregir(entrega.id);
    } catch (err) {
      this.logger.error(`Falló la corrección automática de la entrega ${entrega.id}`, err as Error);
      // La entrega queda creada igual, en estado pendiente_correccion, para reintentar manualmente.
    }

    return this.prisma.entrega.findUnique({
      where: { id: entrega.id },
      include: { correccion: true },
    });
  }

  /** Llama a la IA con consigna + rúbrica + trabajo, y guarda la corrección sugerida. */
  async corregir(entregaId: string) {
    const entrega = await this.prisma.entrega.findUnique({
      where: { id: entregaId },
      include: { trabajoPractico: { include: { criterios: true } } },
    });
    if (!entrega) throw new NotFoundException(`Entrega ${entregaId} no encontrada`);

    const resultado = await this.ai.corregirEntrega({
      consigna: entrega.trabajoPractico.consigna,
      criterios: entrega.trabajoPractico.criterios.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        descripcion: c.descripcion,
        puntajeMaximo: Number(c.puntajeMaximo),
      })),
      textoTrabajo: entrega.textoTrabajo,
    });

    await this.prisma.$transaction([
      this.prisma.correccion.upsert({
        where: { entregaId },
        create: {
          entregaId,
          modeloIa: this.ai.modeloActivo,
          notaPorCriterio: resultado.notaPorCriterio,
          notaTotalSugerida: resultado.notaTotalSugerida,
          feedbackSugerido: resultado.feedbackSugerido,
        },
        update: {
          modeloIa: this.ai.modeloActivo,
          notaPorCriterio: resultado.notaPorCriterio,
          notaTotalSugerida: resultado.notaTotalSugerida,
          feedbackSugerido: resultado.feedbackSugerido,
          // si se re-corrige, se resetea la revisión del docente
          estadoRevision: 'pendiente',
          notaTotalFinal: null,
          feedbackFinal: null,
          revisadoEn: null,
        },
      }),
      this.prisma.entrega.update({
        where: { id: entregaId },
        data: { estado: 'corregido' },
      }),
    ]);

    return this.prisma.entrega.findUnique({
      where: { id: entregaId },
      include: { correccion: true },
    });
  }

  findOne(id: string) {
    return this.prisma.entrega.findUnique({
      where: { id },
      include: { correccion: true, trabajoPractico: { include: { criterios: true } } },
    });
  }
}
