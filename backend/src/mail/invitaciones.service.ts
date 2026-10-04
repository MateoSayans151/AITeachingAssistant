import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EnvioFallido, MailService, MOTIVO_CUOTA } from './mail.service';
import { armarMailInvitacion } from './mail-invitacion.util';

export const MENSAJE_SIN_MAIL_PARA_INVITAR = 'Para mandar invitaciones falta configurar el envío de mails en el servidor: RESEND_API_KEY y EMAIL_FROM.';
export const MENSAJE_INVITACIONES_EN_CURSO = 'Ya hay un envío en curso para este examen.';
export const MENSAJE_SIN_PUBLICACIONES = 'Este examen todavía no está publicado en ninguna comisión: publicalo primero para poder invitar a los alumnos.';
export const MENSAJE_PUBLICACION_AJENA = 'Esa publicación no pertenece a este examen.';
export const MENSAJE_VENTANA_CERRADA = 'La ventana de entrega ya cerró: no tiene sentido invitar a los alumnos a rendir.';
export const MENSAJE_SIN_ALUMNOS = 'No hay alumnos con email cargado en la comisión donde está publicado el examen: cargalos primero.';

export interface EstadoInvitaciones {
  /** El servidor tiene RESEND_API_KEY y EMAIL_FROM: sin eso no se puede mandar nada. */
  configurado: boolean;
  /** Dirección a la que llegan TODOS los mails en vez de a los alumnos (EMAIL_REDIRECT_TO); null = modo normal. */
  modoPrueba: string | null;
  /** Invitaciones del último envío (0 si nunca se mandó). */
  total: number;
  enviados: number;
  conError: number;
  /** Hay un envío corriendo en segundo plano ahora mismo (el front refresca mientras sea true). */
  enCurso: boolean;
  ultimoError: string | null;
}

interface EstadoLote {
  total: number;
  enviados: number;
  conError: number;
  enCurso: boolean;
  ultimoError: string | null;
}

/** Lo que se le manda a UN alumno: a qué publicación (su link) y con qué datos. */
interface Invitacion {
  examenComisionId: string;
  slugAcceso: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  alumnoId: string;
  nombreAlumno: string;
  email: string;
}

/** Lo que es igual para todas las invitaciones del lote. */
interface ContextoExamen {
  titulo: string;
  duracionMinutos: number | null;
  antiCheat: unknown;
  nombreCurso: string;
  nombreDocente: string;
  emailDocente: string;
}

const esperarReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Mismo criterio que NotificacionesService: el rate limit de Resend es de 2 a 10 pedidos por segundo según el plan; con 2
// envíos en paralelo y un segundo de pausa entre uno y otro de cada uno no se pasa de 2 por segundo.
const ENVIOS_EN_PARALELO = 2;
const PAUSA_ENTRE_ENVIOS_MS = 1_000;
/**
 * Resend recuerda la Idempotency-Key 24 h. La clave lleva la "tanda" del envío, que es la ventana de 10 minutos en la
 * que arrancó el lote: un doble clic (o un reintento enseguida) cae en la misma tanda, la clave se repite y Resend no manda
 * dos veces; un reenvío intencional más tarde cae en otra tanda y sale. (Todo el lote usa la tanda en que arrancó.)
 */
const VENTANA_TANDA_MS = 10 * 60_000;

@Injectable()
export class InvitacionesService {
  private readonly logger = new Logger(InvitacionesService.name);
  // Se pisan en los tests (para no esperar de verdad ni depender del reloj); en producción valen las constantes de arriba.
  enviosEnParalelo = ENVIOS_EN_PARALELO;
  pausaEntreEnviosMs = PAUSA_ENTRE_ENVIOS_MS;
  esperar: (ms: number) => Promise<void> = esperarReal;
  ahora: () => Date = () => new Date();

  // Cómo va el último envío de cada examen (id de examen -> estado). Vive SOLO en la memoria de este proceso, a propósito:
  // no hay tabla para esto y alcanza para que la pantalla muestre el avance. Se pierde al reiniciar el servidor (y no se
  // comparte entre instancias): si eso pasa mientras corría un lote, el envío en curso se interrumpe y el estado vuelve a
  // ceros; el docente puede volver a invitar (los que ya recibieron el mail no lo repiten dentro de la tanda, por la
  // Idempotency-Key de Resend).
  private readonly estados = new Map<string, EstadoLote>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** El estado del último envío de este examen; si nunca se mandó, ceros. */
  estado(examenId: string): EstadoInvitaciones {
    const e = this.estados.get(examenId);
    return {
      configurado: this.mail.configurado,
      modoPrueba: this.mail.modoPrueba,
      total: e?.total ?? 0,
      enviados: e?.enviados ?? 0,
      conError: e?.conError ?? 0,
      enCurso: e?.enCurso ?? false,
      ultimoError: e?.ultimoError ?? null,
    };
  }

  /**
   * Manda en segundo plano la invitación a cada alumno de las comisiones donde el examen está publicado (o solo de la
   * publicación `examenComisionId`). Responde enseguida con cuántos mails salen; el avance se consulta con `estado`.
   * 409 si el envío no está configurado, si ya hay un lote en curso para este examen, o si no hay a quién mandarle.
   */
  async invitar(examenId: string, examenComisionId?: string): Promise<{ aEnviar: number }> {
    if (!this.mail.configurado) throw new ConflictException(MENSAJE_SIN_MAIL_PARA_INVITAR);
    if (this.estados.get(examenId)?.enCurso) throw new ConflictException(MENSAJE_INVITACIONES_EN_CURSO);

    // El lugar se reserva ANTES del primer await: dos pedidos a la vez no pasan los dos el chequeo de arriba mientras uno
    // todavía está leyendo la base. Si algo falla antes de lanzar el lote, se devuelve el estado anterior.
    const previo = this.estados.get(examenId);
    const estado: EstadoLote = { total: 0, enviados: 0, conError: 0, enCurso: true, ultimoError: null };
    this.estados.set(examenId, estado);

    let contexto: ContextoExamen;
    let invitaciones: Invitacion[];
    try {
      ({ contexto, invitaciones } = await this.armarInvitaciones(examenId, examenComisionId));
    } catch (err) {
      if (previo) this.estados.set(examenId, previo);
      else this.estados.delete(examenId);
      throw err;
    }

    estado.total = invitaciones.length;
    const tanda = this.tandaActual();
    void this.enviarLote(examenId, estado, contexto, invitaciones, tanda).catch((err) =>
      this.logger.error(`Falló el envío de invitaciones del examen ${examenId}`, err as Error),
    );
    return { aEnviar: invitaciones.length };
  }

  /** Lee el examen con sus publicaciones y alumnos y arma qué mail va a quién. Tira 404/409 si no se puede. */
  private async armarInvitaciones(examenId: string, examenComisionId?: string): Promise<{ contexto: ContextoExamen; invitaciones: Invitacion[] }> {
    // Un id que no es UUID no puede existir (y a Prisma le sale un 500): se trata igual que una publicación ajena.
    if (examenComisionId !== undefined && !isUUID(examenComisionId)) throw new NotFoundException(MENSAJE_PUBLICACION_AJENA);

    const examen = await this.prisma.examen.findUnique({
      where: { id: examenId },
      select: {
        titulo: true,
        duracionMinutos: true,
        antiCheat: true,
        curso: { select: { nombre: true, docente: { select: { nombre: true, email: true } } } },
        comisiones: {
          where: examenComisionId ? { id: examenComisionId } : undefined,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            slugAcceso: true,
            fechaInicio: true,
            fechaFin: true,
            comision: { select: { alumnos: { orderBy: { createdAt: 'asc' }, select: { id: true, nombre: true, email: true } } } },
          },
        },
      },
    });
    if (!examen) throw new NotFoundException(`Examen ${examenId} no encontrado`);

    if (examenComisionId && examen.comisiones.length === 0) throw new NotFoundException(MENSAJE_PUBLICACION_AJENA);
    if (examen.comisiones.length === 0) throw new ConflictException(MENSAJE_SIN_PUBLICACIONES);

    // Una publicación cuya ventana ya cerró no se invita: el mail diría "podés rendirlo hasta…" con una fecha pasada.
    const ahora = this.ahora();
    const vigentes = examen.comisiones.filter((p) => !p.fechaFin || p.fechaFin.getTime() >= ahora.getTime());
    if (vigentes.length === 0) throw new ConflictException(MENSAJE_VENTANA_CERRADA);

    // Un mismo email (sin distinguir mayúsculas ni espacios) recibe UN solo mail por lote, aunque esté cargado dos veces o
    // en dos comisiones: gana la primera publicación en la que aparece.
    const vistos = new Set<string>();
    const invitaciones: Invitacion[] = [];
    for (const p of vigentes) {
      for (const a of p.comision.alumnos) {
        const email = (a.email ?? '').trim();
        const clave = email.toLowerCase();
        if (!email || vistos.has(clave)) continue;
        vistos.add(clave);
        invitaciones.push({
          examenComisionId: p.id,
          slugAcceso: p.slugAcceso,
          fechaInicio: p.fechaInicio,
          fechaFin: p.fechaFin,
          alumnoId: a.id,
          nombreAlumno: a.nombre,
          email,
        });
      }
    }
    if (invitaciones.length === 0) throw new ConflictException(MENSAJE_SIN_ALUMNOS);

    return {
      contexto: {
        titulo: examen.titulo,
        duracionMinutos: examen.duracionMinutos,
        antiCheat: examen.antiCheat,
        nombreCurso: examen.curso.nombre,
        nombreDocente: examen.curso.docente.nombre,
        emailDocente: examen.curso.docente.email,
      },
      invitaciones,
    };
  }

  private tandaActual(): string {
    const ventana = Math.floor(this.ahora().getTime() / VENTANA_TANDA_MS);
    return createHash('sha256').update(String(ventana)).digest('hex').slice(0, 8);
  }

  /**
   * Manda de a pocos (ver ENVIOS_EN_PARALELO) con una pausa entre uno y otro. Un envío fallido suma `conError` y el lote
   * sigue con los demás; si Resend avisa que se agotó el cupo del plan se corta el lote entero (seguir solo gastaría pedidos
   * rechazados) y se deja el motivo en `ultimoError`. Nunca rechaza: lo que falle se cuenta y se loguea.
   */
  private async enviarLote(examenId: string, estado: EstadoLote, contexto: ContextoExamen, invitaciones: Invitacion[], tanda: string): Promise<void> {
    const cola = [...invitaciones];
    let cuotaAgotada = false;
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN');

    const trabajador = async () => {
      while (!cuotaAgotada) {
        const inv = cola.shift();
        if (inv === undefined) return;
        try {
          const { subject, html, text } = armarMailInvitacion({
            nombreAlumno: inv.nombreAlumno,
            emailAlumno: inv.email,
            tituloExamen: contexto.titulo,
            nombreCurso: contexto.nombreCurso,
            nombreDocente: contexto.nombreDocente,
            fechaInicio: inv.fechaInicio,
            fechaFin: inv.fechaFin,
            duracionMinutos: contexto.duracionMinutos,
            antiCheat: contexto.antiCheat,
            slugAcceso: inv.slugAcceso,
            frontendOrigin,
            ahora: this.ahora(),
          });
          const envio = await this.mail.enviar({
            to: inv.email,
            subject,
            html,
            text,
            replyTo: contexto.emailDocente,
            idempotencyKey: `invitacion-${inv.examenComisionId}-${inv.alumnoId}-${tanda}`,
          });
          if (envio.ok) {
            estado.enviados += 1;
          } else {
            // (El proyecto compila sin strictNullChecks: TypeScript no estrecha el resultado por `ok`.)
            const { motivo, cuota } = envio as EnvioFallido;
            estado.conError += 1;
            estado.ultimoError = cuota ? MOTIVO_CUOTA : motivo;
            if (cuota) cuotaAgotada = true;
          }
        } catch (err) {
          estado.conError += 1;
          estado.ultimoError = 'No se pudo armar o enviar la invitación; reintentá más tarde.';
          this.logger.error(`Falló la invitación de ${inv.alumnoId} al examen ${examenId}`, err as Error);
        }
        if (!cuotaAgotada && cola.length > 0 && this.pausaEntreEnviosMs > 0) await this.esperar(this.pausaEntreEnviosMs);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(this.enviosEnParalelo, cola.length) }, trabajador));
    } finally {
      estado.enCurso = false;
    }
  }
}
