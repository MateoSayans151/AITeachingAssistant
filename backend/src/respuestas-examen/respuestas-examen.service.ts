import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { TIPOS_AUTOCORREGIBLES } from '../examenes/dto/create-examen.dto';
import { RegistrarRespuestaDto } from './dto/registrar-respuesta.dto';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';
import { corregirPreguntaCerrada, sanitizarOpcionesParaAlumno } from './correccion-cerradas.util';

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
  ) {}

  /** Trae el examen (sin claves de respuesta) para la página pública de rendir. */
  async obtenerParaRendir(slug: string) {
    const examenComision = await this.prisma.examenComision.findUnique({
      where: { slugAcceso: slug },
      include: {
        examen: { include: { preguntas: { orderBy: { orden: 'asc' }, include: { criterios: true } } } },
        comision: true,
      },
    });
    if (!examenComision) throw new NotFoundException('Link de acceso inválido');

    this.validarVentana(examenComision);

    return {
      examen: {
        id: examenComision.examen.id,
        titulo: examenComision.examen.titulo,
        consigna: examenComision.examen.consigna,
        modalidad: examenComision.examen.modalidad,
        duracionMinutos: examenComision.examen.duracionMinutos,
        preguntas: examenComision.examen.preguntas.map((p) => ({
          id: p.id,
          tipo: p.tipo,
          enunciado: p.enunciado,
          puntajeMaximo: p.puntajeMaximo,
          opciones: sanitizarOpcionesParaAlumno(p.tipo, p.opciones),
        })),
      },
      comision: { id: examenComision.comision.id, nombre: examenComision.comision.nombre },
    };
  }

  private validarVentana(examenComision: { fechaInicio: Date | null; fechaFin: Date | null }) {
    const ahora = new Date();
    if (examenComision.fechaInicio && ahora < examenComision.fechaInicio) {
      throw new BadRequestException('Todavía no se abrió la ventana de entrega de este examen');
    }
    if (examenComision.fechaFin && ahora > examenComision.fechaFin) {
      throw new BadRequestException('La ventana de entrega de este examen ya cerró');
    }
  }

  /**
   * Simulación consciente del "alumno rinde por link": no hay autenticación de alumnos
   * en el proyecto, así que identificamos al alumno por email contra el roster ya cargado
   * de la comisión, sin timer ni anti-cheat de sesión. Ver plan de implementación.
   */
  async crear(slug: string, dto: RegistrarRespuestaDto) {
    const examenComision = await this.prisma.examenComision.findUnique({
      where: { slugAcceso: slug },
      include: { examen: true },
    });
    if (!examenComision) throw new NotFoundException('Link de acceso inválido');
    this.validarVentana(examenComision);

    const alumno = await this.prisma.alumno.findFirst({
      where: { comisionId: examenComision.comisionId, email: dto.alumnoEmail },
    });
    if (!alumno) {
      throw new NotFoundException('Ese email no está en el listado de esta comisión. Consultá con tu docente.');
    }

    const existente = await this.prisma.respuestaExamen.findUnique({
      where: { examenId_alumnoId: { examenId: examenComision.examenId, alumnoId: alumno.id } },
    });
    if (existente) throw new BadRequestException('Ya enviaste una respuesta para este examen');

    const respuestasPorPreguntaInicial: RespuestaPorPregunta[] = dto.respuestas.map((r) => ({
      preguntaId: r.preguntaId,
      contenidoRespuesta: r.contenido ?? null,
      notaSugerida: 0,
      notaFinal: null,
    }));

    const respuesta = await this.prisma.respuestaExamen.create({
      data: {
        examenId: examenComision.examenId,
        alumnoId: alumno.id,
        respuestasPorPregunta: respuestasPorPreguntaInicial as any,
      },
    });

    // Igual que EntregasService.create(): se corrige sincrónicamente y, si la IA falla,
    // la respuesta queda creada igual (pendiente_correccion) para reintentar a mano.
    try {
      await this.corregir(respuesta.id);
    } catch (err) {
      this.logger.error(`Falló la corrección automática de la respuesta ${respuesta.id}`, err as Error);
    }

    return this.prisma.respuestaExamen.findUnique({ where: { id: respuesta.id }, include: { alumno: true } });
  }

  /** Corrige (o re-corrige) una respuesta: cerradas en código, abiertas con IA. */
  async corregir(respuestaId: string) {
    const respuesta = await this.prisma.respuestaExamen.findUnique({
      where: { id: respuestaId },
      include: {
        examen: { include: { preguntas: { orderBy: { orden: 'asc' }, include: { criterios: true } } } },
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
        notaTotalFinal: null,
        feedbackGeneralFinal: null,
        revisadoEn: null,
      },
    });

    return this.prisma.respuestaExamen.findUnique({ where: { id: respuestaId }, include: { alumno: true } });
  }

  findAllByExamen(examenId: string) {
    return this.prisma.respuestaExamen.findMany({
      where: { examenId },
      orderBy: { createdAt: 'asc' },
      include: { alumno: true },
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
    return respuesta;
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

    // Igual que en bulkAceptar: si ya se le aplicó una vara mientras estaba "pendiente",
    // respetamos ese ajuste en vez de pisarlo con la sugerencia cruda de la IA.
    const notaTotalFinal =
      dto.estadoRevision === 'aceptada'
        ? Number(respuesta.notaTotalFinal ?? respuesta.notaTotalSugerida ?? 0)
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
            // Si ya se le aplicó una vara mientras estaba "pendiente", notaTotalFinal ya
            // tiene ese valor ajustado — no lo pisamos con la sugerencia cruda de la IA.
            notaTotalFinal: r.notaTotalFinal ?? r.notaTotalSugerida,
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
