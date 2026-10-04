import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Envío de mails con Resend (https://resend.com/docs/api-reference/emails/send-email). Es solo el transporte: qué se
// manda y a quién lo decide NotificacionesService. Nunca tira: devuelve un resultado tipado con un motivo legible,
// porque el motivo le llega tal cual al docente en la pantalla de notas.

const URL_RESEND = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;
/** Cuánto se espera, como máximo, antes de reintentar un 429 por rate limit (aunque Resend pida más en Retry-After). */
const ESPERA_MAX_REINTENTO_MS = 5_000;
const ESPERA_REINTENTO_MS = 1_000;

/** Mensaje para el docente cuando se agotó el cupo diario/mensual del plan de Resend. */
export const MOTIVO_CUOTA = 'Se alcanzó el límite de envíos de tu plan de Resend; reintentá más tarde.';

/** Lo que se le puede inyectar al servicio (solo los tests lo hacen): el `fetch` y la espera entre reintentos. */
export const MAIL_DEPENDENCIAS = 'MAIL_DEPENDENCIAS';
export interface MailDependencias {
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
}

export interface MailParaEnviar {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Resend la guarda 24 h: dos pedidos con la misma clave y el mismo contenido mandan un solo mail. */
  idempotencyKey?: string;
}

export interface EnvioFallido {
  ok: false;
  /** Para mostrarle al docente: en castellano y corto. */
  motivo: string;
  /** Se agotó el cupo diario/mensual del plan de Resend (reintentar enseguida no sirve). */
  cuota?: boolean;
}
export type ResultadoEnvio = { ok: true } | EnvioFallido;

interface ErrorResend {
  name?: string;
  message?: string;
}

const esperarReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly fetchImpl: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(MAIL_DEPENDENCIAS) dependencias?: MailDependencias,
  ) {
    this.fetchImpl = dependencias?.fetch ?? ((url, init) => fetch(url, init));
    this.esperar = dependencias?.esperar ?? esperarReal;
  }

  // Las variables se leen en cada uso (no en el constructor): un valor mal cargado se corrige sin recompilar nada.
  private get apiKey(): string {
    return (this.config.get<string>('RESEND_API_KEY') ?? '').trim();
  }

  private get remitente(): string {
    return (this.config.get<string>('EMAIL_FROM') ?? '').trim();
  }

  /** Hay API key y remitente: sin las dos no se puede mandar nada (y publicar notas se rechaza). */
  get configurado(): boolean {
    return this.apiKey !== '' && this.remitente !== '';
  }

  /** Modo prueba: la dirección a la que llegan TODOS los mails en vez de a los alumnos (null = modo normal). */
  get modoPrueba(): string | null {
    return (this.config.get<string>('EMAIL_REDIRECT_TO') ?? '').trim() || null;
  }

  async enviar(mail: MailParaEnviar): Promise<ResultadoEnvio> {
    if (!this.configurado) {
      return { ok: false, motivo: 'El envío de mails no está configurado en el servidor (faltan RESEND_API_KEY y EMAIL_FROM).' };
    }

    const redirigido = this.modoPrueba;
    const cuerpo = {
      from: this.remitente,
      to: [redirigido ?? mail.to],
      subject: redirigido ? `[PRUEBA → ${mail.to}] ${mail.subject}` : mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    };

    try {
      let respuesta = await this.postear(cuerpo, mail.idempotencyKey);
      // Un 429 por límite de pedidos por segundo se reintenta una vez; el de cuota (diaria/mensual) no tiene arreglo
      // inmediato y se informa aparte para que el lote entero se corte.
      if (respuesta.status === 429 && !esCuota(respuesta.error)) {
        await this.esperar(esperaDeReintento(respuesta.retryAfter));
        respuesta = await this.postear(cuerpo, mail.idempotencyKey);
      }
      return this.interpretar(respuesta);
    } catch (err) {
      return this.falloDeRed(err);
    }
  }

  private async postear(cuerpo: unknown, idempotencyKey?: string) {
    const res = await this.fetchImpl(URL_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await res.text().catch(() => '');
    return { status: res.status, ok: res.ok, error: parsearError(texto), retryAfter: res.headers?.get?.('retry-after') ?? null };
  }

  private interpretar(r: { status: number; ok: boolean; error: ErrorResend; retryAfter: string | null }): ResultadoEnvio {
    if (r.ok) return { ok: true };

    const detalle = this.limpiar(r.error.message ?? '');
    const sufijo = detalle ? `: ${detalle}` : '';
    let resultado: { motivo: string; cuota?: boolean };

    if (r.status === 429) {
      resultado = esCuota(r.error)
        ? { motivo: MOTIVO_CUOTA, cuota: true }
        : { motivo: 'Resend limitó el ritmo de envíos y no alcanzó con reintentar; probá de nuevo en un rato.' };
    } else if (r.status === 401 || /api_key/.test(r.error.name ?? '')) {
      resultado = { motivo: `Resend rechazó las credenciales: revisá RESEND_API_KEY${sufijo}` };
    } else if (r.status === 409 && r.error.name === 'concurrent_idempotent_requests') {
      resultado = { motivo: 'Ya había un envío en curso de este mismo mail; probá de nuevo en un rato.' };
    } else if (r.status >= 500) {
      resultado = { motivo: `Resend no está disponible en este momento (HTTP ${r.status}); reintentá más tarde.` };
    } else {
      resultado = { motivo: `Resend rechazó el mail${sufijo || ` (HTTP ${r.status})`}` };
    }

    // En el log solo va el estado y el nombre del error de Resend: nunca la clave ni el contenido del mail.
    this.logger.warn(`Resend respondió ${r.status}${r.error.name ? ` (${this.limpiar(r.error.name)})` : ''}`);
    return { ok: false, ...resultado };
  }

  private falloDeRed(err: unknown): ResultadoEnvio {
    const e = err as { name?: string; message?: string };
    const vencio = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    this.logger.warn(`No se pudo hablar con Resend: ${vencio ? 'timeout' : this.limpiar(e?.message ?? 'error de red')}`);
    return {
      ok: false,
      motivo: vencio
        ? 'Resend no respondió a tiempo; reintentá más tarde.'
        : `No se pudo conectar con Resend: ${this.limpiar(e?.message ?? 'error de red')}`,
    };
  }

  /** Un texto que va a un log o al docente: sin la API key (por si algún error de red la repitiera) y acotado. */
  private limpiar(texto: string): string {
    const key = this.apiKey;
    const sinClave = key ? texto.split(key).join('***') : texto;
    const corto = sinClave.replace(/\s+/g, ' ').trim();
    return corto.length > 200 ? `${corto.slice(0, 200)}…` : corto;
  }
}

/** Resend responde `{ name, message, statusCode }` en los errores; se tolera que venga otra forma o texto plano. */
function parsearError(texto: string): ErrorResend {
  try {
    const json = JSON.parse(texto) as Record<string, any>;
    const interno = json?.error && typeof json.error === 'object' ? json.error : json;
    return {
      name: typeof interno?.name === 'string' ? interno.name : undefined,
      message: typeof interno?.message === 'string' ? interno.message : typeof json?.error === 'string' ? json.error : undefined,
    };
  } catch {
    return { message: texto.trim() || undefined };
  }
}

function esCuota(error: ErrorResend): boolean {
  return error.name === 'daily_quota_exceeded' || error.name === 'monthly_quota_exceeded' || /quota/i.test(error.message ?? '');
}

/** `Retry-After` viene en segundos; se respeta hasta un tope corto, y sin el header se espera un segundo. */
function esperaDeReintento(retryAfter: string | null): number {
  const segundos = Number(retryAfter);
  if (retryAfter == null || retryAfter.trim() === '' || !Number.isFinite(segundos) || segundos < 0) return ESPERA_REINTENTO_MS;
  return Math.min(segundos * 1000, ESPERA_MAX_REINTENTO_MS);
}
