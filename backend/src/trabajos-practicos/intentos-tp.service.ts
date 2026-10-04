import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EntregasService } from '../entregas/entregas.service';
import { GRACIA_ENTREGA_MS } from '../respuestas-examen/intentos.service';
import { MAX_CONTENIDO_BYTES } from '../respuestas-examen/limites';
import { EventoIntegridadDto } from '../respuestas-examen/dto/intento.dto';
import { IniciarEntregaDto } from './dto/entregar.dto';

const BARRIDO_VENCIDOS_MS = 60_000;

/** Distinto del 'intento' de los exámenes: un token no sirve en el link del otro flujo. */
export const TIPO_TOKEN_ENTREGA = 'intento-tp';

const CAMPO_POR_EVENTO = {
  salida_pantalla_completa: 'salidasPantalla',
  cambio_pestana: 'cambiosPestana',
  pegado: 'pegados',
} as const;

/**
 * El alumno entregando un trabajo práctico desde su link (/entregar/<slug>). Misma mecánica que rendir un
 * examen (reloj del servidor, autoguardado, señales de integridad), pero sin lista de alumnos: se identifica con
 * el nombre y el email que escribe, y el resultado es una Entrega común que sigue el flujo de siempre.
 */
@Injectable()
export class IntentosTpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntentosTpService.name);
  private barrido?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly entregas: EntregasService,
  ) {}

  onModuleInit() {
    // Si el alumno cierra la pestaña y nunca vuelve, igual se entrega lo autoguardado al vencer.
    this.barrido = setInterval(() => {
      this.cerrarVencidos().catch((e) => this.logger.error('Falló el barrido de entregas vencidas', e as Error));
    }, BARRIDO_VENCIDOS_MS);
    this.barrido.unref?.();
  }

  onModuleDestroy() {
    if (this.barrido) clearInterval(this.barrido);
  }

  // ---------------------------------------------------------------------------
  // Info pública del link (sin la consigna: se entrega recién al iniciar, con el reloj ya corriendo)
  // ---------------------------------------------------------------------------
  async info(slug: string) {
    const tp = await this.trabajo(slug);
    const ahora = new Date();
    const estado = tp.fechaFin && ahora > tp.fechaFin ? 'cerrada' : tp.fechaInicio && ahora < tp.fechaInicio ? 'no_abierta' : 'abierta';
    return {
      trabajo: { titulo: tp.titulo, materia: tp.materia, modoSeguro: tp.modoSeguro, duracionMinutos: tp.duracionMinutos },
      ventana: { estado, fechaInicio: tp.fechaInicio, fechaFin: tp.fechaFin },
    };
  }

  // ---------------------------------------------------------------------------
  // Iniciar (o retomar) el intento
  // ---------------------------------------------------------------------------
  async iniciar(slug: string, dto: IniciarEntregaDto) {
    const tp = await this.trabajo(slug);
    const alumnoEmail = dto.alumnoEmail.trim().toLowerCase();
    const clave = { trabajoPracticoId_alumnoEmail: { trabajoPracticoId: tp.id, alumnoEmail } };

    let intento = await this.prisma.intentoEntrega.findUnique({ where: clave });

    if (!intento) {
      this.validarVentana(tp);
      if (tp.modoSeguro && dto.consentimiento !== true) {
        throw new BadRequestException('Tenés que aceptar el aviso de qué se monitorea para poder empezar');
      }
      const ahora = new Date();
      let expiraEn = tp.duracionMinutos ? new Date(ahora.getTime() + tp.duracionMinutos * 60_000) : null;
      if (tp.fechaFin && (!expiraEn || tp.fechaFin < expiraEn)) expiraEn = tp.fechaFin;
      if (!expiraEn) throw new BadRequestException('Este link no tiene tiempo ni vencimiento configurado');
      try {
        intento = await this.prisma.intentoEntrega.create({
          data: {
            trabajoPracticoId: tp.id,
            alumnoNombre: dto.alumnoNombre.trim(),
            alumnoEmail,
            inicioEn: ahora,
            expiraEn,
            consentimientoEn: tp.modoSeguro ? ahora : null,
          },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // dos pestañas iniciando a la vez: usamos el que ganó
        intento = await this.prisma.intentoEntrega.findUniqueOrThrow({ where: clave });
      }
    }

    if (intento.estado !== 'en_curso') throw new BadRequestException('Ya entregaste este trabajo práctico');
    if (this.estaVencido(intento)) {
      await this.finalizar(intento.id);
      throw new BadRequestException('El tiempo ya terminó. Lo que alcanzaste a completar se entregó.');
    }

    return { token: await this.firmarToken(intento), ...(await this.estadoIntento(intento.id, slug)) };
  }

  /** Estado actual del intento (para retomar tras un refresh): consigna + borrador + vencimiento. */
  async estadoIntento(intentoId: string, slug: string) {
    const tp = await this.trabajo(slug);
    const intento = await this.prisma.intentoEntrega.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado === 'en_curso' && this.estaVencido(intento)) {
      await this.finalizar(intento.id);
      throw new ConflictException('El tiempo ya terminó. Lo que alcanzaste a completar se entregó.');
    }
    if (intento.estado !== 'en_curso') throw new ConflictException('Este trabajo ya fue entregado');

    return {
      ahora: new Date().toISOString(), // para que el cliente corrija la diferencia de reloj
      expiraEn: intento.expiraEn,
      borrador: intento.borrador,
      modoSeguro: tp.modoSeguro,
      consigna: tp.consigna,
    };
  }

  // ---------------------------------------------------------------------------
  // Autoguardado, señales y entrega (autenticados con el token del intento)
  // ---------------------------------------------------------------------------
  async guardarBorrador(intentoId: string, texto: string) {
    await this.intentoActivo(intentoId);
    this.validarTamano(texto, 'El borrador');
    const guardadoEn = new Date();
    await this.prisma.intentoEntrega.update({ where: { id: intentoId }, data: { borrador: texto, borradorActualizadoEn: guardadoEn } });
    return { guardadoEn };
  }

  async registrarEvento(intentoId: string, dto: EventoIntegridadDto) {
    const intento = await this.intentoActivo(intentoId);
    // Solo se registra si el docente activó el modo seguro (y el alumno lo aceptó al empezar).
    if (!intento.trabajoPractico.modoSeguro || !intento.consentimientoEn) return { registrado: false };
    await this.prisma.intentoEntrega.update({ where: { id: intentoId }, data: { [CAMPO_POR_EVENTO[dto.tipo]]: { increment: 1 } } });
    return { registrado: true };
  }

  async entregar(intentoId: string, texto?: string) {
    const intento = await this.prisma.intentoEntrega.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado !== 'en_curso') throw new ConflictException('Este trabajo ya fue entregado');

    const tarde = this.estaVencido(intento, GRACIA_ENTREGA_MS);
    // Pasado el margen no se acepta contenido nuevo del cliente: vale lo último autoguardado.
    const contenido = tarde ? undefined : texto;
    if (contenido !== undefined) this.validarTamano(contenido, 'La entrega');
    if (!tarde && !(contenido ?? intento.borrador).trim()) throw new BadRequestException('Escribí tu trabajo antes de entregarlo');

    const r = await this.finalizar(intentoId, contenido, tarde ? 'vencido' : 'entregado');
    return { recibida: true, enviadoEn: r?.entregadoEn ?? new Date(), aTiempo: !tarde };
  }

  // ---------------------------------------------------------------------------
  // Cierre de intentos (entrega del alumno, vencimiento o barrido)
  // ---------------------------------------------------------------------------
  /**
   * Convierte el intento en una Entrega (una sola vez, aunque lleguen dos pedidos a la vez) y la manda a
   * corregir en segundo plano: el alumno no espera a la IA. Sin texto no se crea entrega.
   */
  async finalizar(intentoId: string, texto?: string, estado: 'entregado' | 'vencido' = 'vencido') {
    const intento = await this.prisma.intentoEntrega.findUnique({ where: { id: intentoId } });
    if (!intento) return null;

    const final = texto ?? intento.borrador;
    try {
      // El `where` con el estado es el "reclamo" atómico: solo un pedido encuentra el intento en_curso.
      // La entrega se crea en la misma operación, así nunca queda un intento cerrado sin su entrega.
      const cerrado = await this.prisma.intentoEntrega.update({
        where: { id: intentoId, estado: 'en_curso' },
        data: {
          estado,
          entregadoEn: new Date(),
          borrador: final,
          ...(final.trim()
            ? {
                entrega: {
                  create: {
                    trabajoPracticoId: intento.trabajoPracticoId,
                    alumnoNombre: intento.alumnoNombre,
                    alumnoEmail: intento.alumnoEmail,
                    textoTrabajo: final,
                  },
                },
              }
            : {}),
        },
        include: { entrega: { select: { id: true } } },
      });
      if (cerrado.entrega) {
        void this.entregas
          .corregir(cerrado.entrega.id)
          .catch((err) => this.logger.error(`Falló la corrección automática de la entrega ${cerrado.entrega!.id}`, err as Error));
      }
      return cerrado;
    } catch (e: any) {
      if (e?.code === 'P2025') return null; // otro pedido ya lo cerró
      throw e;
    }
  }

  /** Cierra los intentos vencidos (pasado el margen). Lo llama el barrido. */
  async cerrarVencidos() {
    const limite = new Date(Date.now() - GRACIA_ENTREGA_MS);
    const vencidos = await this.prisma.intentoEntrega.findMany({
      where: { estado: 'en_curso', expiraEn: { lt: limite } },
      select: { id: true },
    });
    for (const v of vencidos) {
      try {
        await this.finalizar(v.id);
      } catch (e) {
        this.logger.error(`No se pudo cerrar el intento vencido ${v.id}`, e as Error);
      }
    }
    return vencidos.length;
  }

  // ---------------------------------------------------------------------------
  // Token del intento (aislado del de docentes y del de exámenes: typ 'intento-tp')
  // ---------------------------------------------------------------------------
  private async firmarToken(intento: { id: string; expiraEn: Date }) {
    const restanteS = Math.ceil((intento.expiraEn.getTime() - Date.now() + GRACIA_ENTREGA_MS) / 1000);
    return this.jwt.signAsync({ sub: intento.id, typ: TIPO_TOKEN_ENTREGA }, { expiresIn: Math.max(restanteS, 60) });
  }

  /** Valida el Bearer del alumno y que el intento sea de este link. Devuelve el id del intento. */
  async intentoDeToken(authorization: string | undefined, slug: string): Promise<string> {
    const [tipo, token] = (authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token de la entrega');
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('La sesión venció. Volvé a ingresar con tu nombre y email.');
    }
    if (payload.typ !== TIPO_TOKEN_ENTREGA) throw new UnauthorizedException('Token inválido');

    const tp = await this.trabajo(slug);
    const intento = await this.prisma.intentoEntrega.findUnique({ where: { id: payload.sub } });
    if (!intento || intento.trabajoPracticoId !== tp.id) throw new ForbiddenException('Este intento no corresponde a este trabajo práctico');
    return intento.id;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  private async trabajo(slug: string) {
    const tp = await this.prisma.trabajoPractico.findUnique({ where: { slugAcceso: slug } });
    if (!tp) throw new NotFoundException('Link de acceso inválido');
    return tp;
  }

  private validarVentana(tp: { fechaInicio: Date | null; fechaFin: Date | null }) {
    const ahora = new Date();
    if (tp.fechaInicio && ahora < tp.fechaInicio) throw new BadRequestException('Todavía no se abrió la entrega de este trabajo práctico');
    if (tp.fechaFin && ahora > tp.fechaFin) throw new BadRequestException('La entrega de este trabajo práctico ya cerró');
  }

  private estaVencido(intento: { expiraEn: Date }, margenMs = 0): boolean {
    return Date.now() > intento.expiraEn.getTime() + margenMs;
  }

  /** Intento en curso y no vencido; si venció lo cierra (entregando el borrador) y avisa. */
  private async intentoActivo(intentoId: string) {
    const intento = await this.prisma.intentoEntrega.findUnique({
      where: { id: intentoId },
      include: { trabajoPractico: { select: { modoSeguro: true } } },
    });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado !== 'en_curso') throw new ConflictException('Este trabajo ya fue entregado');
    if (this.estaVencido(intento, GRACIA_ENTREGA_MS)) {
      await this.finalizar(intento.id);
      throw new ConflictException('El tiempo terminó. Lo que alcanzaste a completar se entregó.');
    }
    return intento;
  }

  private validarTamano(texto: string, que: string) {
    if (Buffer.byteLength(texto) > MAX_CONTENIDO_BYTES) {
      throw new BadRequestException(`${que} es demasiado grande (el máximo es ${Math.round(MAX_CONTENIDO_BYTES / 1000)} KB de texto)`);
    }
  }
}
