import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { armarResultadoParaAlumno, debeNotificarse } from '../respuestas-examen/resultado.util';
import { EnvioFallido, MailService, MOTIVO_CUOTA } from './mail.service';
import { armarMailResultado } from './mail-resultado.util';

export const MENSAJE_SIN_MAIL_PARA_PUBLICAR = 'Para publicar las notas falta configurar el envío de mails en el servidor: RESEND_API_KEY y EMAIL_FROM.';
export const MENSAJE_SIN_MAIL_PARA_REENVIAR = 'Para reenviar los mails falta configurar el envío en el servidor: RESEND_API_KEY y EMAIL_FROM.';

export const MENSAJE_SIN_SELECCION_NOTAS = 'Elegí al menos un alumno para mandarle su resultado.';
export const MENSAJE_SELECCION_NOTAS_AJENA = 'Alguna de las respuestas elegidas no es de este examen.';
export const MENSAJE_SELECCION_SIN_NOTA = 'Ninguno de los elegidos tiene todavía su respuesta revisada con las notas publicadas.';

export interface DestinatarioNotificacion {
  respuestaId: string;
  nombre: string;
  email: string;
  notaFinal: number | null;
  /** Cuándo se le mandó (null = todavía no) y el último error si el intento falló. */
  enviadoEn: Date | null;
  error: string | null;
  enCamino: boolean;
}

export interface DestinatariosNotificacion {
  destinatarios: DestinatarioNotificacion[];
  /** Respuestas sin revisar (o con las notas sin publicar): no figuran en la lista porque todavía no les toca. */
  aunNoLesToca: number;
}

/** Qué pasó con el mail de una respuesta. `omitido` = no correspondía mandarlo (o ya estaba mandado / en camino). */
export type ResultadoNotificacion = 'enviado' | 'omitido' | 'error' | 'cuota';

export interface ResumenNotificaciones {
  /** El servidor tiene RESEND_API_KEY y EMAIL_FROM: sin eso no se puede publicar ni enviar nada. */
  configurado: boolean;
  /** Dirección a la que llegan TODOS los mails en vez de a los alumnos (EMAIL_REDIRECT_TO); null = modo normal. */
  modoPrueba: string | null;
  enviados: number;
  /** Les tocaba el mail y el último intento falló. */
  conError: number;
  /** Les toca el mail y todavía no se intentó (o está en camino). */
  sinEnviar: number;
  /** Respuestas que siguen sin revisar: no se les manda nada hasta que el docente las revise. */
  sinRevisar: number;
  /** Envíos de este examen que el servidor tiene en marcha ahora mismo (el front refresca mientras haya). */
  enCurso: number;
  ultimoError: string | null;
}

const esperarReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// El rate limit de Resend es de 2 a 10 pedidos por segundo por equipo, según el plan: con 2 envíos en paralelo y un
// segundo de pausa entre uno y otro de cada uno no se pasa de 2 por segundo, y para un curso de 100 alumnos son ~1 minuto.
const ENVIOS_EN_PARALELO = 2;
const PAUSA_ENTRE_ENVIOS_MS = 1_000;

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  // Se pisan en los tests (para no esperar de verdad); en producción valen las constantes de arriba.
  enviosEnParalelo = ENVIOS_EN_PARALELO;
  pausaEntreEnviosMs = PAUSA_ENTRE_ENVIOS_MS;
  esperar: (ms: number) => Promise<void> = esperarReal;

  // Respuestas cuyo mail se está armando/enviando ahora: dos pedidos a la vez por la misma no mandan dos mails.
  private readonly enCurso = new Set<string>();
  // Respuestas que un lote tomó y todavía no terminó (id -> examen): un 2º "reenviar" no las duplica y el resumen
  // puede decir cuántas quedan.
  private readonly enLote = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  get configurado(): boolean {
    return this.mail.configurado;
  }

  /**
   * Manda por mail el resultado de UNA respuesta, si corresponde: revisada, con las notas publicadas (o feedback
   * inmediato) y todavía sin notificar. Nunca vuelve a mandar una que ya salió: `notificadoEn` no se toca al
   * re-corregir ni al re-revisar, así que cambiarle la nota a alguien que ya la recibió NO le manda un segundo mail
   * solo. ("Reenviar" reintenta únicamente a los que no recibieron nada; un reenvío individual de una nota cambiada
   * después del envío todavía no existe.)
   *
   * Si el envío falla, el motivo queda en `notificacionError` y `notificadoEn` en null (se reintenta con "reenviar").
   * Dos llamadas simultáneas por la misma respuesta no duplican el mail: la segunda se omite, y además Resend
   * descarta repetidos con la misma Idempotency-Key.
   */
  async notificarRespuesta(respuestaId: string, forzar = false): Promise<ResultadoNotificacion> {
    if (!this.mail.configurado || this.enCurso.has(respuestaId)) return 'omitido';
    this.enCurso.add(respuestaId);
    try {
      return await this.enviarUna(respuestaId, forzar);
    } finally {
      this.enCurso.delete(respuestaId);
    }
  }

  /** `forzar`: el docente eligió a mano volver a mandarle el mail a alguien que ya lo recibió. */
  private async enviarUna(respuestaId: string, forzar: boolean): Promise<ResultadoNotificacion> {
    const respuesta = await this.prisma.respuestaExamen.findUnique({
      where: { id: respuestaId },
      include: {
        alumno: true,
        examen: { include: { preguntas: { orderBy: { orden: 'asc' } }, curso: { include: { docente: true } } } },
      },
    });
    if (!respuesta || (respuesta.notificadoEn && !forzar) || !debeNotificarse(respuesta, respuesta.examen)) return 'omitido';

    const { examen, alumno } = respuesta;
    const docente = examen.curso.docente;
    const { subject, html, text } = armarMailResultado(armarResultadoParaAlumno(examen, examen.preguntas, respuesta), {
      nombreAlumno: alumno.nombre,
      nombreDocente: docente.nombre,
      nombreCurso: examen.curso.nombre,
    });

    const envio = await this.mail.enviar({
      to: alumno.email.trim(),
      subject,
      html,
      text,
      replyTo: docente.email,
      // Resend la recuerda 24 h. Lleva un hash del contenido: si el envío falla, el docente cambia la nota y reintenta
      // dentro de ese día, la clave nueva deja pasar el mail corregido (con la misma clave y otro contenido Resend
      // respondería 409); y si el contenido es el mismo, el reintento no duplica un mail que sí había salido.
      // Un reenvío a propósito lleva la fecha del envío anterior: con la misma clave Resend lo descartaría en silencio (24 h).
      idempotencyKey: `resultado-${respuesta.id}-${createHash('sha256').update(`${subject}\n${html}`).digest('hex').slice(0, 12)}${forzar && respuesta.notificadoEn ? `-reenvio-${respuesta.notificadoEn.getTime()}` : ''}`,
    });

    if (envio.ok) {
      await this.prisma.respuestaExamen.update({ where: { id: respuesta.id }, data: { notificadoEn: new Date(), notificacionError: null } });
      return 'enviado';
    }
    // (El proyecto compila sin strictNullChecks: TypeScript no estrecha el resultado por `ok`.)
    const { motivo, cuota } = envio as EnvioFallido;
    await this.prisma.respuestaExamen.update({ where: { id: respuesta.id }, data: { notificacionError: motivo } });
    return cuota ? 'cuota' : 'error';
  }

  /**
   * Manda en segundo plano el resultado de todas las respuestas del examen que les toca y todavía no lo recibieron
   * (incluye las que fallaron antes). Responde enseguida con cuántas son: las que ya están en camino se cuentan pero
   * no se lanzan de nuevo.
   */
  async notificarExamen(examenId: string): Promise<{ aEnviar: number }> {
    if (!this.mail.configurado) return { aEnviar: 0 };
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId }, select: { feedbackModo: true, feedbackLiberadoEn: true } });
    if (!examen) return { aEnviar: 0 };

    const candidatas = await this.prisma.respuestaExamen.findMany({
      where: { examenId, notificadoEn: null },
      select: { id: true, estadoRevision: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids = candidatas.filter((r) => debeNotificarse(r, examen)).map((r) => r.id);
    this.lanzarLote(examenId, ids);
    return { aEnviar: ids.length };
  }

  /**
   * Los alumnos a los que ya se les puede mandar su resultado (respuesta revisada y notas publicadas, o feedback inmediato), con
   * si ya lo recibieron: es la lista que el docente tilda antes de enviar. Los que todavía no les toca solo se cuentan.
   */
  async destinatarios(examenId: string): Promise<DestinatariosNotificacion> {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId }, select: { feedbackModo: true, feedbackLiberadoEn: true } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);
    const respuestas = await this.prisma.respuestaExamen.findMany({
      where: { examenId },
      orderBy: [{ alumno: { nombre: 'asc' } }],
      select: {
        id: true,
        estadoRevision: true,
        notaTotalFinal: true,
        notificadoEn: true,
        notificacionError: true,
        alumno: { select: { nombre: true, email: true } },
      },
    });
    const enLista = respuestas.filter((r) => debeNotificarse(r, examen));
    return {
      destinatarios: enLista.map((r) => ({
        respuestaId: r.id,
        nombre: r.alumno.nombre,
        email: r.alumno.email,
        notaFinal: r.notaTotalFinal == null ? null : Number(r.notaTotalFinal),
        enviadoEn: r.notificadoEn,
        error: r.notificadoEn ? null : r.notificacionError,
        enCamino: this.enLote.has(r.id) || this.enCurso.has(r.id),
      })),
      aunNoLesToca: respuestas.length - enLista.length,
    };
  }

  /**
   * Manda el resultado SOLO a las respuestas elegidas por el docente. Las que ya lo recibieron se vuelven a mandar (es lo que
   * pidió al tildarlas). Rechaza las que no son de este examen o todavía no les toca; las que ya están en camino no se repiten.
   * Responde enseguida con cuántos mails salen.
   */
  async notificarSeleccion(examenId: string, respuestaIds: string[]): Promise<{ aEnviar: number }> {
    if (!this.mail.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_REENVIAR);
    const ids = [...new Set(respuestaIds)];
    if (ids.length === 0) throw new ConflictException(MENSAJE_SIN_SELECCION_NOTAS);
    if (!ids.every((id) => isUUID(id))) throw new NotFoundException(MENSAJE_SELECCION_NOTAS_AJENA);
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId }, select: { feedbackModo: true, feedbackLiberadoEn: true } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);
    const filas = await this.prisma.respuestaExamen.findMany({ where: { examenId, id: { in: ids } }, select: { id: true, estadoRevision: true } });
    if (filas.length !== ids.length) throw new NotFoundException(MENSAJE_SELECCION_NOTAS_AJENA);
    const ahora = filas.filter((r) => debeNotificarse(r, examen)).map((r) => r.id);
    if (ahora.length === 0) throw new ConflictException(MENSAJE_SELECCION_SIN_NOTA);
    this.lanzarLote(examenId, ahora, true);
    return { aEnviar: ahora.length };
  }

  /**
   * Al publicar las notas: manda solo a las respuestas elegidas que no lo recibieron todavía (publicar nunca repite un mail ya
   * enviado; para eso está `notificarSeleccion`). Una lista vacía no manda nada. Los ids ajenos al examen se descartan.
   */
  async notificarSeleccionAlPublicar(examenId: string, respuestaIds: string[]): Promise<{ aEnviar: number }> {
    if (!this.mail.configurado || respuestaIds.length === 0) return { aEnviar: 0 };
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId }, select: { feedbackModo: true, feedbackLiberadoEn: true } });
    if (!examen) return { aEnviar: 0 };
    const filas = await this.prisma.respuestaExamen.findMany({
      where: { examenId, id: { in: respuestaIds.filter((id) => isUUID(id)) }, notificadoEn: null },
      select: { id: true, estadoRevision: true },
    });
    const ids = filas.filter((r) => debeNotificarse(r, examen)).map((r) => r.id);
    this.lanzarLote(examenId, ids);
    return { aEnviar: ids.length };
  }

  /** Lanza en segundo plano el envío de estas respuestas (las que otro lote ya tiene no se repiten). Nunca rechaza. */
  lanzarLote(examenId: string, ids: string[], forzar = false): void {
    const nuevas = ids.filter((id) => !this.enLote.has(id) && !this.enCurso.has(id));
    nuevas.forEach((id) => this.enLote.set(id, examenId));
    void this.enviarLote(nuevas, forzar).catch((err) => this.logger.error(`Falló el envío de mails del examen ${examenId}`, err as Error));
  }

  /** Cuántos envíos de este examen hay en marcha. */
  enCursoDe(examenId: string): number {
    return [...this.enLote.values()].filter((e) => e === examenId).length;
  }

  /**
   * Manda de a pocos (ver ENVIOS_EN_PARALELO) con una pausa entre uno y otro. Un error en una respuesta se loguea y sigue
   * con las demás; si Resend avisa que se agotó el cupo del plan se corta el lote entero (seguir solo gastaría
   * pedidos rechazados) y las que quedaron sin enviar guardan ese motivo para que el docente lo vea.
   */
  private async enviarLote(ids: string[], forzar = false): Promise<void> {
    const cola = [...ids];
    let cuotaAgotada = false;
    const trabajador = async () => {
      while (!cuotaAgotada) {
        const id = cola.shift();
        if (id === undefined) return;
        try {
          if ((await this.notificarRespuesta(id, forzar)) === 'cuota') cuotaAgotada = true;
        } catch (err) {
          this.logger.error(`Falló el envío del resultado de la respuesta ${id}`, err as Error);
        } finally {
          this.enLote.delete(id);
        }
        if (!cuotaAgotada && cola.length > 0 && this.pausaEntreEnviosMs > 0) await this.esperar(this.pausaEntreEnviosMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.enviosEnParalelo, cola.length) }, trabajador));

    // Lo que quedó en la cola es porque se cortó el lote por la cuota: se les deja el motivo.
    const sinEnviar = cola.splice(0);
    try {
      if (sinEnviar.length > 0) {
        await this.prisma.respuestaExamen.updateMany({
          where: { id: { in: sinEnviar }, notificadoEn: null },
          data: { notificacionError: MOTIVO_CUOTA },
        });
      }
    } finally {
      sinEnviar.forEach((id) => this.enLote.delete(id));
    }
  }

  async resumen(examenId: string): Promise<ResumenNotificaciones> {
    const examen = await this.prisma.examen.findUnique({ where: { id: examenId }, select: { feedbackModo: true, feedbackLiberadoEn: true } });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);
    const respuestas = await this.prisma.respuestaExamen.findMany({
      where: { examenId },
      orderBy: { createdAt: 'asc' },
      select: { estadoRevision: true, notificadoEn: true, notificacionError: true },
    });

    const resumen = { enviados: 0, conError: 0, sinEnviar: 0, sinRevisar: 0 };
    let ultimoError: string | null = null;
    for (const r of respuestas) {
      if (r.estadoRevision === 'pendiente') resumen.sinRevisar += 1;
      if (r.notificadoEn) {
        resumen.enviados += 1;
        continue;
      }
      if (!debeNotificarse(r, examen)) continue; // todavía no le toca (sin revisar, o notas sin publicar)
      if (r.notificacionError) {
        resumen.conError += 1;
        ultimoError = r.notificacionError;
      } else {
        resumen.sinEnviar += 1;
      }
    }
    return { configurado: this.mail.configurado, modoPrueba: this.mail.modoPrueba, ...resumen, enCurso: this.enCursoDe(examenId), ultimoError };
  }
}
