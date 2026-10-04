import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { TIPOS_AUTOCORREGIBLES } from '../examenes/dto/create-examen.dto';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';
import { corregirPreguntaCerrada } from './correccion-cerradas.util';
import { RagService, armarConsultaRag } from '../rag/rag.service';
import { MaterialCursoInput } from '../ai/ai.types';
import { LimitadorConcurrencia, maxConcurrentesDesdeEnv } from '../ai/limitador-concurrencia.util';

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
  // Tope de llamadas a la IA (RAG + LLM) en simultáneo en todo el proceso (env IA_MAX_CONCURRENTES).
  readonly limitador = new LimitadorConcurrencia(maxConcurrentesDesdeEnv(process.env.IA_MAX_CONCURRENTES));
  // Correcciones en marcha por id de respuesta, incluidas las que esperan turno en el limitador.
  private readonly enCurso = new Map<string, Promise<void>>();
  // Ids que una tanda de "corregir pendientes" tomó y todavía no procesó: un 2º click no los duplica.
  private readonly enLote = new Set<string>();

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

  /**
   * Corrige (o re-corrige) una respuesta: cerradas en código, abiertas con IA. Es el único punto
   * que corrige. Si esa respuesta ya se está corrigiendo (o espera turno para la IA) se engancha
   * a esa corrección en vez de lanzar otra: no se paga la IA dos veces ni se pisan los resultados.
   * Si la IA falla, el error se propaga y la respuesta queda como estaba (pendiente_correccion).
   */
  async corregir(respuestaId: string) {
    let tarea = this.enCurso.get(respuestaId);
    if (!tarea) {
      tarea = this.corregirUnaVez(respuestaId).finally(() => this.enCurso.delete(respuestaId));
      this.enCurso.set(respuestaId, tarea);
    }
    await tarea;
    return this.prisma.respuestaExamen.findUnique({ where: { id: respuestaId }, include: { alumno: true } });
  }

  /**
   * Reintenta en segundo plano las respuestas del examen que quedaron en pendiente_correccion
   * (429 del proveedor, IA caída). Responde enseguida con cuántas hay; las que ya se están
   * corrigiendo o ya tomó otra tanda se cuentan pero no se lanzan de nuevo: terminan solas.
   */
  async corregirPendientes(examenId: string): Promise<{ pendientes: number }> {
    const pendientes = await this.prisma.respuestaExamen.findMany({
      where: { examenId, estado: 'pendiente_correccion' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const nuevas = pendientes.map((p) => p.id).filter((id) => !this.enCurso.has(id) && !this.enLote.has(id));
    nuevas.forEach((id) => this.enLote.add(id));
    void this.corregirLote(nuevas);
    return { pendientes: pendientes.length };
  }

  /**
   * Corrige los ids de a pocos (tantos como llamadas simultáneas admite el limitador, así no se
   * disparan cientos de lecturas a la base de golpe). Un error en una respuesta se loguea y sigue
   * con las demás; nunca rechaza.
   */
  async corregirLote(ids: string[]): Promise<void> {
    const cola = [...ids];
    const trabajador = async () => {
      for (let id = cola.shift(); id !== undefined; id = cola.shift()) {
        try {
          await this.corregir(id);
        } catch (err) {
          this.logger.error(`Falló la re-corrección de la respuesta ${id}`, err as Error);
        } finally {
          this.enLote.delete(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.limitador.maximo, cola.length) }, trabajador));
  }

  private async corregirUnaVez(respuestaId: string): Promise<void> {
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
      // RAG + LLM van juntos bajo el limitador: son las llamadas externas que se saturan
      // cuando entrega medio curso a la vez.
      resultadoAbiertas = await this.limitador.ejecutar(async () => {
        const materialRecuperado = await this.materialDeCatedra(
          respuestaId,
          respuesta.examen.cursoId,
          abiertas.map((p) => ({ enunciado: p.enunciado, respuesta: String(contenidoPorPregunta.get(p.id) ?? '') })),
        );
        return this.ai.corregirRespuestaExamen({
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
  }

  /**
   * El material de cátedra es un apoyo, no un requisito: si la búsqueda falla (pgvector sin
   * migrar, cuota de embeddings agotada...) se corrige sin él en vez de tumbar la corrección.
   */
  private async materialDeCatedra(
    respuestaId: string,
    cursoId: string,
    preguntas: Array<{ enunciado: string; respuesta: string }>,
  ): Promise<MaterialCursoInput[]> {
    try {
      return await this.rag.buscarMaterial(cursoId, armarConsultaRag(preguntas));
    } catch (err) {
      this.logger.warn(
        `No se pudo traer el material de cátedra para la respuesta ${respuestaId}; se corrige sin material: ${(err as Error).message}`,
      );
      return [];
    }
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

    // Aceptar confirma la nota que sugirió la IA: si nunca corrigió (notaTotalSugerida null) no hay
    // nada que confirmar, y aceptar dejaría una nota 0 como si fuera la definitiva. Editar sí vale:
    // el docente puede calificar a mano lo que la IA no pudo corregir.
    if (dto.estadoRevision === 'aceptada' && respuesta.notaTotalSugerida == null) {
      throw new ConflictException(
        'Esta respuesta todavía no fue corregida por la IA: corregila primero o cargá la nota a mano.',
      );
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

  /**
   * Acepta en bloque las respuestas corregidas y todavía pendientes de revisión de un examen.
   * Las que la IA nunca corrigió (siguen en pendiente_correccion, sin nota sugerida) quedan afuera:
   * aceptarlas las marcaría como revisadas sin nota.
   */
  async bulkAceptar(examenId: string) {
    const pendientes = await this.prisma.respuestaExamen.findMany({
      where: { examenId, estado: 'corregido', estadoRevision: 'pendiente', notaTotalSugerida: { not: null } },
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
