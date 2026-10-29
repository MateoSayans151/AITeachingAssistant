import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { armarMailCodigo } from '../mail/mail-codigo.util';
import { AlmacenFallosPrisma } from './almacen-fallos.prisma';
import { LimitadorFallos } from './limitador-intentos.util';

// Código de acceso (OTP) para rendir: 6 dígitos que llegan al mail, de un solo uso.
//   - Se guarda un HMAC (con un secreto del servidor), nunca el código en claro: seis dígitos se adivinan en un instante si la
//     tabla se filtra, y con el HMAC hace falta además el secreto.
//   - Cada código admite pocos intentos, y además hay un freno acumulado por mail e IP: pedir códigos nuevos no resetea nada.
//   - Pedir un código responde siempre lo mismo (exista o no el mail en la lista): no sirve para averiguar quién cursa.

export const TTL_CODIGO_MS = 10 * 60_000;
export const MAX_INTENTOS_POR_CODIGO = 5;
export const ESPERA_ENTRE_CODIGOS_MS = 60_000;
export const MAX_CODIGOS_10MIN_POR_EMAIL = 3;
export const MAX_CODIGOS_HORA_POR_EMAIL = 8;
/**
 * Topes globales: un aula entera empieza a la vez y comparte IP (NAT), así que tienen que quedar bien por encima de una clase real
 * (cientos de alumnos en un par de minutos). Frenan scripts desatados, no son la defensa contra quien agota la cuota de mails con mails
 * al azar: esa es el dominio permitido (o la lista de alumnos) y, a futuro, un captcha en el pedido de código.
 */
export const MAX_CODIGOS_MINUTO_POR_PUBLICACION = 150;
export const MAX_CODIGOS_10MIN_POR_IP = 400;
const MAX_FALLOS_VERIFICACION = 12;
/** Los fallos por IP cuentan a toda un aula que comparte conexión: el límite real es por mail (arriba) y por código. */
const MAX_FALLOS_VERIFICACION_POR_IP = 300;
const VENTANA_FALLOS_MS = 10 * 60_000;

export function generarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCodigo(secreto: string, examenComisionId: string, email: string, codigo: string): string {
  return createHmac('sha256', secreto).update(`otp|${examenComisionId}|${email.toLowerCase()}|${codigo}`).digest('hex');
}

/** "@Alumnos.Edu.ar " -> "alumnos.edu.ar"; vacío -> null. */
export function normalizarDominio(valor: string | null | undefined): string | null {
  const d = (valor ?? '').trim().toLowerCase().replace(/^@+/, '');
  return d || null;
}

/** ¿El mail es de ese dominio (o de un subdominio)? Sin dominio configurado, cualquiera vale. */
export function emailEnDominio(email: string, dominio: string | null | undefined): boolean {
  const d = normalizarDominio(dominio);
  if (!d) return true;
  const host = email.trim().toLowerCase().split('@')[1] ?? '';
  return host === d || host.endsWith(`.${d}`);
}

export interface PublicacionParaCodigo {
  id: string;
  accesoAbierto: boolean;
  comisionId: string;
  dominioPermitido: string | null;
  examen: { titulo: string };
  comision: { nombre: string };
}

@Injectable()
export class CodigosAccesoService {
  private readonly logger = new Logger(CodigosAccesoService.name);
  private readonly fallos: LimitadorFallos;
  private readonly fallosPorIp: LimitadorFallos;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    const almacen = new AlmacenFallosPrisma(prisma);
    this.fallos = new LimitadorFallos(almacen, MAX_FALLOS_VERIFICACION, VENTANA_FALLOS_MS);
    this.fallosPorIp = new LimitadorFallos(almacen, MAX_FALLOS_VERIFICACION_POR_IP, VENTANA_FALLOS_MS);
  }

  private get secreto(): string {
    return this.config.get<string>('JWT_SECRET') ?? '';
  }

  private demasiados(mensaje: string): never {
    throw new HttpException(mensaje, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Pide un código. Siempre responde igual salvo por los límites y por un dominio no permitido (eso se le dice: no revela nada
   * sobre quién cursa). Si el mail no está en la lista (y el acceso no es abierto), no se manda nada pero se responde igual.
   */
  async solicitar(pub: PublicacionParaCodigo, email: string, ip: string): Promise<void> {
    if (!emailEnDominio(email, pub.dominioPermitido)) {
      throw new BadRequestException(`Para rendir este examen tenés que usar un mail de @${normalizarDominio(pub.dominioPermitido)}.`);
    }
    const ahora = Date.now();
    const desde = (ms: number) => new Date(ahora - ms);
    const porEmail = (ms: number) =>
      this.prisma.codigoAcceso.count({ where: { examenComisionId: pub.id, email, createdAt: { gte: desde(ms) } } });

    const ultimo = await this.prisma.codigoAcceso.findFirst({
      where: { examenComisionId: pub.id, email },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (ultimo && ahora - ultimo.createdAt.getTime() < ESPERA_ENTRE_CODIGOS_MS) {
      this.demasiados('Ya te mandamos un código hace un momento. Esperá un minuto para pedir otro.');
    }
    if ((await porEmail(10 * 60_000)) >= MAX_CODIGOS_10MIN_POR_EMAIL || (await porEmail(60 * 60_000)) >= MAX_CODIGOS_HORA_POR_EMAIL) {
      this.demasiados('Pediste demasiados códigos. Esperá unos minutos y probá de nuevo.');
    }
    if ((await this.prisma.codigoAcceso.count({ where: { examenComisionId: pub.id, createdAt: { gte: desde(60_000) } } })) >= MAX_CODIGOS_MINUTO_POR_PUBLICACION) {
      this.demasiados('Hay muchos pedidos de código en este momento. Probá de nuevo en un minuto.');
    }
    if ((await this.prisma.codigoAcceso.count({ where: { ip, createdAt: { gte: desde(10 * 60_000) } } })) >= MAX_CODIGOS_10MIN_POR_IP) {
      this.demasiados('Demasiados pedidos desde tu conexión. Probá de nuevo en unos minutos.');
    }

    const elegible =
      pub.accesoAbierto ||
      !!(await this.prisma.alumno.findFirst({ where: { comisionId: pub.comisionId, email: { equals: email, mode: 'insensitive' } }, select: { id: true } }));

    const codigo = generarCodigo();
    // Siempre se anota (también para mails que no están en la lista): así el límite frena igual el sondeo de mails.
    const fila = await this.prisma.codigoAcceso.create({
      data: {
        examenComisionId: pub.id,
        email,
        codigoHash: elegible ? hashCodigo(this.secreto, pub.id, email, codigo) : hashCodigo(this.secreto, pub.id, email, `x${codigo}`),
        expiraEn: new Date(ahora + TTL_CODIGO_MS),
        ip,
      },
    });
    if (!elegible) return;

    const armado = armarMailCodigo({
      codigo,
      tituloExamen: pub.examen.titulo,
      nombreComision: pub.comision.nombre,
      validezMinutos: Math.round(TTL_CODIGO_MS / 60_000),
    });
    if (!this.mail.configurado && process.env.NODE_ENV !== 'production') {
      // Desarrollo sin Resend: el código va al log del servidor para poder probar el flujo.
      this.logger.warn(`[DESARROLLO] código para ${email}: ${codigo}`);
      return;
    }
    const r = await this.mail.enviar({ to: email, ...armado, idempotencyKey: `otp-${fila.id}` });
    if ('motivo' in r) {
      this.logger.warn(`No se pudo mandar el código: ${r.motivo}`);
      await this.prisma.codigoAcceso.delete({ where: { id: fila.id } }).catch(() => undefined);
      throw new ServiceUnavailableException('No pudimos enviarte el código por mail. Probá de nuevo en unos minutos o avisale a tu docente.');
    }
  }

  /** Valida el código y lo consume. Cualquier falla responde lo mismo (401) para no dar pistas. */
  async consumir(pub: { id: string }, email: string, codigo: string | undefined, ip: string): Promise<void> {
    const claveEmail = `cod|${pub.id}|${email}`;
    const claveIp = `codip|${ip}`;
    await this.fallos.verificar(claveEmail);
    await this.fallosPorIp.verificar(claveIp);

    const falla = async (): Promise<never> => {
      await this.fallos.fallo(claveEmail);
      await this.fallosPorIp.fallo(claveIp);
      throw new UnauthorizedException('El código es incorrecto o venció. Revisalo o pedí uno nuevo.');
    };
    if (!codigo) return falla();

    const fila = await this.prisma.codigoAcceso.findFirst({
      where: { examenComisionId: pub.id, email, consumidoEn: null, expiraEn: { gt: new Date() }, intentos: { lt: MAX_INTENTOS_POR_CODIGO } },
      orderBy: { createdAt: 'desc' },
    });
    if (!fila) return falla();

    const esperado = Buffer.from(fila.codigoHash, 'hex');
    const recibido = Buffer.from(hashCodigo(this.secreto, pub.id, email, codigo), 'hex');
    const coincide = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
    if (!coincide) {
      await this.prisma.codigoAcceso.update({ where: { id: fila.id }, data: { intentos: { increment: 1 } } });
      return falla();
    }
    // Un solo uso, aunque lleguen dos pedidos a la vez: solo uno logra marcarlo.
    const marcado = await this.prisma.codigoAcceso.updateMany({ where: { id: fila.id, consumidoEn: null }, data: { consumidoEn: new Date() } });
    if (marcado.count === 0) return falla();
    await this.fallos.exito(claveEmail);
  }

  /** Limpieza de códigos viejos (el barrido de IntentosService la llama). */
  async purgar(): Promise<number> {
    const r = await this.prisma.codigoAcceso.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
    return r.count;
  }
}
