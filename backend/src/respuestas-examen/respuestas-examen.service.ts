import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { TIPOS_AUTOCORREGIBLES } from '../examenes/dto/create-examen.dto';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';
import { corregirPreguntaCerrada } from './correccion-cerradas.util';
import { RagService } from '../rag/rag.service';

type RespuestaPorPregunta = {
  preguntaId: string;
  contenidoRespuesta: unknown;
  notaSugerida: number;
  notaFinal: number | null;
  correcta?: boolean;
  notaPorCriterio?: Array<{ criterioId: string; nombre: string; nivelSugerido: number; notaSugerida: number; comentario: string }>;
};

@Injectable()
export class RespuestasExamenService {
  private readonly logger = new Logger(RespuestasExamenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly rag: RagService,
  ) {}

  /**
   * Crea la respuesta de un alumno a partir de lo que entregó (o de su último borrador, si
   * venció el tiempo) y dispara la corrección. La corrección corre en segundo plano: el
   * alumno no espera a la IA, y si falla la respuesta queda pendiente para re-corregir a mano.
   */
  async crearDesdeContenido(examenId: string, alumnoId: string, contenidoPorPregunta: Record<string, unknown>) {
    const preguntas = await this.prisma.pregunta.findMany({ where: { examenId }, orderBy: { orden: 'asc' }, select: { id: true } });
    // Una entrada por pregunta del examen (las que no contestó quedan en null).
    const inicial: RespuestaPorPregunta[] = preguntas.map((p) => ({
      preguntaId: p.id,
      contenidoRespuesta: contenidoPorPregunta[p.id] ?? null,
      notaSugerida: 0,
      notaFinal: null,
    }));

    const respuesta = await this.prisma.respuestaExamen.create({
      data: { examenId, alumnoId, respuestasPorPregunta: inicial as any },
    });

    void this.corregir(respuesta.id).catch((err) =>
      this.logger.error(`Falló la corrección automática de la respuesta ${respuesta.id}`, err as Error),
    );
    return respuesta;
  }

  /** Corrige (o re-corrige) una respuesta: cerradas en código, abiertas con IA. */
  async corregir(respuestaId: string) {
    const respuesta = await this.prisma.respuestaExamen.findUnique({
      where: { id: respuestaId },
      include: {
        examen: {
          include: {
            preguntas: { orderBy: { orden: 'asc' }, include: { criterios: true } },
            curso: true,
          },
        },
      },
    });
    if (!respuesta) throw new NotFoundException(`Respuesta ${respuestaId} no encontrada`);

    const contenidoPorPregunta = new Map(
      (respuesta.respuestasPorPregunta as RespuestaPorPregunta[]).map((r) => [r.preguntaId, r.contenidoRespuesta]),
    );

    const cerradas = respuesta.examen.preguntas.filter((p) => TIPOS_AUTOCORREGIBLES.includes(p.tipo));
    const abiertas = respuesta.examen.preguntas.filter((p) => !TIPOS_AUTOCORREGIBLES.includes(p.tipo));

    const resultadoCerradas = new Map(
      cerradas.map((p) => [p.id, corregirPreguntaCerrada(p.tipo, p.opciones, contenidoPorPregunta.get(p.id))]),
    );

    let resultadoAbiertas = { porPregunta: [] as any[], notaTotalSugerida: 0, feedbackGeneralSugerido: '' };
    if (abiertas.length > 0) {
      const consultaRag = abiertas
        .map((p) => `${p.enunciado}\n${String(contenidoPorPregunta.get(p.id) ?? '')}`)
        .join('\n\n');
      const materialRecuperado = await this.rag.buscarMaterial(respuesta.examen.cursoId, consultaRag);
      resultadoAbiertas = await this.ai.corregirRespuestaExamen({
        preguntas: abiertas.map((p) => ({
          id: p.id,
          enunciado: p.enunciado,
          criterios: p.criterios.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            descripcion: c.descripcion,
            puntajeMaximo: Number(c.puntajeMaximo),
            nivelesDescripcion: c.nivelesDescripcion as any,
          })),
        })),
        respuestasAlumno: abiertas.map((p) => ({
          preguntaId: p.id,
          texto: String(contenidoPorPregunta.get(p.id) ?? ''),
        })),
        niveles: respuesta.examen.niveles as any,
        materialCurso: materialRecuperado,
      });
    }

    const abiertasPorId = new Map(resultadoAbiertas.porPregunta.map((r) => [r.preguntaId, r]));

    const respuestasPorPregunta: RespuestaPorPregunta[] = respuesta.examen.preguntas.map((p) => {
      const contenidoRespuesta = contenidoPorPregunta.get(p.id) ?? null;
      if (TIPOS_AUTOCORREGIBLES.includes(p.tipo)) {
        const r = resultadoCerradas.get(p.id)!;
        return {
          preguntaId: p.id,
          contenidoRespuesta,
          notaSugerida: r.correcta ? Number(p.puntajeMaximo) : 0,
          correcta: r.correcta,
          notaFinal: null,
        };
      }
      const r = abiertasPorId.get(p.id);
      return {
        preguntaId: p.id,
        contenidoRespuesta,
        notaSugerida: r?.notaSugerida ?? 0,
        notaPorCriterio: r?.notaPorCriterio ?? [],
        notaFinal: null,
      };
    });

    const notaTotalSugerida = respuestasPorPregunta.reduce((sum, r) => sum + r.notaSugerida, 0);

    await this.prisma.respuestaExamen.update({
      where: { id: respuestaId },
      data: {
        modeloIa: abiertas.length > 0 ? this.ai.modeloActivo : null,
        respuestasPorPregunta: respuestasPorPregunta as any,
        notaTotalSugerida,
        feedbackGeneralSugerido:
          resultadoAbiertas.feedbackGeneralSugerido || 'Corrección automática (preguntas de clave/opción).',
        estado: 'corregido',
        estadoRevision: 'pendiente',
        // La nota base cambió: la vara que se le había aplicado ya no corresponde.
        notaConVara: null,
        ajusteVaraId: null,
        notaTotalFinal: null,
        feedbackGeneralFinal: null,
        revisadoEn: null,
      },
    });

    return this.prisma.respuestaExamen.findUnique({ where: { id: respuestaId }, include: { alumno: true } });
  }

  async findAllByExamen(examenId: string) {
    const respuestas = await this.prisma.respuestaExamen.findMany({
      where: { examenId },
      orderBy: { createdAt: 'asc' },
      include: { alumno: true },
    });
    const intentos = await this.prisma.intentoExamen.findMany({
      where: { examenId },
      include: { _count: { select: { eventos: true } } },
    });
    const porAlumno = new Map(intentos.map((i) => [i.alumnoId, i]));
    return respuestas.map((r) => {
      const i = porAlumno.get(r.alumnoId);
      return { ...r, intento: i ? { estado: i.estado, eventos: i._count.eventos } : null };
    });
  }

  async findOne(examenId: string, id: string) {
    const respuesta = await this.prisma.respuestaExamen.findUnique({
      where: { id },
      include: {
        alumno: true,
        examen: { include: { preguntas: { orderBy: { orden: 'asc' }, include: { criterios: true } } } },
      },
    });
    if (!respuesta || respuesta.examenId !== examenId) {
      throw new NotFoundException(`Respuesta ${id} no encontrada`);
    }
    const intento = await this.prisma.intentoExamen.findUnique({
      where: { examenId_alumnoId: { examenId, alumnoId: respuesta.alumnoId } },
      include: { eventos: { orderBy: { ocurridoEn: 'asc' } } },
    });
    return {
      ...respuesta,
      // Señales de integridad: informativas para el criterio del docente, no tocan la nota.
      integridad: intento
        ? {
            estado: intento.estado,
            inicioEn: intento.inicioEn,
            entregadoEn: intento.entregadoEn,
            expiraEn: intento.expiraEn,
            consentimientoEn: intento.consentimientoEn,
            eventos: intento.eventos.map((e) => ({ tipo: e.tipo, ocurridoEn: e.ocurridoEn, detalle: e.detalle })),
          }
        : null,
    };
  }

  /** El docente confirma o edita la corrección sugerida. Igual criterio que CorreccionesService. */
  async revisar(examenId: string, id: string, dto: RevisarRespuestaExamenDto) {
    const respuesta = await this.prisma.respuestaExamen.findUnique({ where: { id } });
    if (!respuesta || respuesta.examenId !== examenId) {
      throw new NotFoundException(`Respuesta ${id} no encontrada`);
    }

    const actuales = respuesta.respuestasPorPregunta as RespuestaPorPregunta[];
    let respuestasPorPregunta: RespuestaPorPregunta[];

    if (dto.estadoRevision === 'aceptada') {
      respuestasPorPregunta = actuales.map((r) => ({ ...r, notaFinal: r.notaSugerida }));
    } else {
      const overridesPorId = new Map((dto.overridesPorPregunta ?? []).map((o) => [o.preguntaId, o.notaFinal]));
      respuestasPorPregunta = actuales.map((r) => ({
        ...r,
        notaFinal: overridesPorId.has(r.preguntaId) ? overridesPorId.get(r.preguntaId)! : (r.notaFinal ?? r.notaSugerida),
      }));
    }

    // Aceptar confirma la nota sugerida tal como está hoy: con la vara vigente, si tiene una.
    // Editar es decisión del docente y se impone a la vara.
    const notaTotalFinal =
      dto.estadoRevision === 'aceptada'
        ? Number(respuesta.notaConVara ?? respuesta.notaTotalSugerida ?? 0)
        : (dto.notaTotalFinal ?? respuestasPorPregunta.reduce((sum, r) => sum + Number(r.notaFinal ?? 0), 0));

    const feedbackGeneralFinal =
      dto.estadoRevision === 'aceptada'
        ? respuesta.feedbackGeneralSugerido
        : (dto.feedbackGeneralFinal ?? respuesta.feedbackGeneralSugerido);

    return this.prisma.respuestaExamen.update({
      where: { id },
      data: {
        respuestasPorPregunta: respuestasPorPregunta as any,
        notaTotalFinal,
        feedbackGeneralFinal,
        estadoRevision: dto.estadoRevision,
        estado: 'revisado',
        revisadoEn: new Date(),
      },
    });
  }

  /** Acepta en bloque todas las respuestas todavía pendientes de revisión de un examen. */
  async bulkAceptar(examenId: string) {
    const pendientes = await this.prisma.respuestaExamen.findMany({
      where: { examenId, estadoRevision: 'pendiente' },
    });
    if (pendientes.length === 0) return [];

    await this.prisma.$transaction(
      pendientes.map((r) => {
        const respuestasPorPregunta = (r.respuestasPorPregunta as RespuestaPorPregunta[]).map((x) => ({
          ...x,
          notaFinal: x.notaSugerida,
        }));
        return this.prisma.respuestaExamen.update({
          where: { id: r.id },
          data: {
            respuestasPorPregunta: respuestasPorPregunta as any,
            // Se confirma la sugerencia con la vara vigente, si tiene una.
            notaTotalFinal: r.notaConVara ?? r.notaTotalSugerida,
            feedbackGeneralFinal: r.feedbackGeneralSugerido,
            estadoRevision: 'aceptada',
            estado: 'revisado',
            revisadoEn: new Date(),
          },
        });
      }),
    );

    return this.findAllByExamen(examenId);
  }
}
