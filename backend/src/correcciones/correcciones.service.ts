import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RevisarCorreccionDto } from './dto/revisar-correccion.dto';

@Injectable()
export class CorreccionesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El docente confirma o edita la corrección sugerida por la IA.
   * Este es el punto de control humano del flujo: nada se libera al alumno sin pasar por acá.
   */
  async revisar(entregaId: string, dto: RevisarCorreccionDto) {
    const correccion = await this.prisma.correccion.findUnique({ where: { entregaId } });
    if (!correccion) throw new NotFoundException(`No hay corrección para la entrega ${entregaId}`);

    const [correccionActualizada] = await this.prisma.$transaction([
      this.prisma.correccion.update({
        where: { entregaId },
        data: {
          estadoRevision: dto.estadoRevision,
          notaTotalFinal:
            dto.estadoRevision === 'aceptada'
              ? correccion.notaTotalSugerida
              : (dto.notaTotalFinal ?? correccion.notaTotalSugerida),
          feedbackFinal:
            dto.estadoRevision === 'aceptada' ? correccion.feedbackSugerido : (dto.feedbackFinal ?? correccion.feedbackSugerido),
          revisadoEn: new Date(),
        },
      }),
      this.prisma.entrega.update({
        where: { id: entregaId },
        data: { estado: 'revisado' },
      }),
    ]);

    return correccionActualizada;
  }
}
