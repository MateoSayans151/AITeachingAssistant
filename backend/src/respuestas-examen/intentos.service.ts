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
import { RespuestasExamenService } from './respuestas-examen.service';
import { sanitizarOpcionesParaAlumno } from './correccion-cerradas.util';
import { antiCheatActivo, eventoPermitido } from './anticheat.util';
import { LimitadorFallos } from './limitador-intentos.util';
import { AlmacenFallosPrisma } from './almacen-fallos.prisma';
import { MAX_CONTENIDO_BYTES } from './limites';
import { EventoIntegridadDto, IniciarIntentoDto } from './dto/intento.dto';

/** Margen para que llegue una entrega hecha justo al vencer (latencia, reloj del cliente). */
export const GRACIA_ENTREGA_MS = 20_000;
const MAX_EVENTOS_POR_INTENTO = 500;
const VENTANA_FALLOS_MS = 10 * 60_000;
const BARRIDO_VENCIDOS_MS = 60_000;

@Injectable()
export class IntentosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntentosService.name);
  private barrido?: NodeJS.Timeout;
  private readonly almacenFallos: AlmacenFallosPrisma;
  private readonly fallosPorIp: LimitadorFallos;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly respuestas: RespuestasExamenService,
  ) {
    // Los fallos viven en la base (no en memoria del proceso): el freno vale con varias instancias.
    this.almacenFallos = new AlmacenFallosPrisma(prisma);
    this.fallosPorIp = new LimitadorFallos(this.almacenFallos, 60, VENTANA_FALLOS_MS);
  }

  onModuleInit() {
    // Si el alumno cierra la pestaña y nunca vuelve, igual se entrega lo autoguardado al vencer.
    this.barrido = setInterval(() => {
      this.cerrarVencidos().catch((e) => this.logger.error('Falló el barrido de intentos vencidos', e as Error));
      this.almacenFallos
        .purgarAnteriores(Date.now() - 2 * VENTANA_FALLOS_MS)
        .catch((e) => this.logger.error('Falló la limpieza de fallos de acceso', e as Error));
    }, BARRIDO_VENCIDOS_MS);
    this.barrido.unref?.();
  }

  onModuleDestroy() {
    if (this.barrido) clearInterval(this.barrido);
  }

  // ---------------------------------------------------------------------------
  // Info pública del link (sin preguntas: esas se entregan recién al iniciar)
  // ---------------------------------------------------------------------------
  async info(slug: string) {
    const ec = await this.examenComision(slug);
    const ahora = new Date();
    const ventana = ec.fechaFin && ahora > ec.fechaFin ? 'cerrada' : ec.fechaInicio && ahora < ec.fechaInicio ? 'no_abierta' : 'abierta';
    return {
      examen: {
        titulo: ec.examen.titulo,
        consigna: ec.examen.consigna,
        modalidad: ec.examen.modalidad,
        duracionMinutos: ec.examen.duracionMinutos,
        antiCheat: antiCheatActivo(ec.examen.antiCheat),
      },
      comision: { nombre: ec.comision.nombre },
      ventana: { estado: ventana, fechaInicio: ec.fechaInicio, fechaFin: ec.fechaFin },
    };
  }

  // ---------------------------------------------------------------------------
  // Iniciar (o retomar) el intento
  // ---------------------------------------------------------------------------
  async iniciar(slug: string, dto: IniciarIntentoDto, ip: string) {
    const ec = await this.examenComision(slug);
    const claveIp = `ip|${ip}`;
    await this.fallosPorIp.verificar(claveIp);

    const alumno = await this.prisma.alumno.findFirst({ where: { comisionId: ec.comisionId, email: dto.alumnoEmail } });
    // El alumno se identifica solo con su email (sin código). El freno por IP limita que alguien
    // pruebe emails al azar para ver quién está en la comisión.
    if (!alumno) {
      await this.fallosPorIp.fallo(claveIp);
      throw new UnauthorizedException('Ese email no está en el listado de esta comisión. Revisalo o consultá con tu docente.');
    }

    const yaEntrego = await this.prisma.respuestaExamen.count({ where: { examenId: ec.examenId, alumnoId: alumno.id } });
    if (yaEntrego) throw new BadRequestException('Ya enviaste una respuesta para este examen');

    let intento = await this.prisma.intentoExamen.findUnique({
      where: { examenId_alumnoId: { examenId: ec.examenId, alumnoId: alumno.id } },
    });

    if (!intento) {
      this.validarVentana(ec);
      const cfg = antiCheatActivo(ec.examen.antiCheat);
      if (cfg && dto.consentimiento !== true) {
        throw new BadRequestException('Tenés que aceptar el aviso de qué se monitorea durante el examen para poder empezar');
      }
      const ahora = new Date();
      let expiraEn: Date | null = ec.examen.duracionMinutos ? new Date(ahora.getTime() + ec.examen.duracionMinutos * 60_000) : null;
      if (ec.fechaFin && (!expiraEn || ec.fechaFin < expiraEn)) expiraEn = ec.fechaFin;
      try {
        intento = await this.prisma.intentoExamen.create({
          data: { examenId: ec.examenId, alumnoId: alumno.id, inicioEn: ahora, expiraEn, consentimientoEn: cfg ? ahora : null },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // dos pestañas iniciando a la vez: usamos el que ganó
        intento = await this.prisma.intentoExamen.findUniqueOrThrow({
          where: { examenId_alumnoId: { examenId: ec.examenId, alumnoId: alumno.id } },
        });
      }
    }

    if (intento.estado !== 'en_curso' || this.estaVencido(intento)) {
      await this.finalizar(intento.id);
      throw new BadRequestException('El tiempo de este examen ya terminó. Lo que alcanzaste a completar se entregó.');
    }

    return { token: await this.firmarToken(intento), ...(await this.estadoIntento(intento.id, slug)) };
  }

  /** Estado actual del intento (para retomar tras un refresh): preguntas + borrador + vencimiento. */
  async estadoIntento(intentoId: string, slug: string) {
    const ec = await this.examenComision(slug);
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado === 'en_curso' && this.estaVencido(intento)) {
      await this.finalizar(intento.id);
      throw new ConflictException('El tiempo de este examen ya terminó. Lo que alcanzaste a completar se entregó.');
    }
    if (intento.estado !== 'en_curso') throw new ConflictException('Este examen ya fue entregado');

    const preguntas = await this.prisma.pregunta.findMany({ where: { examenId: ec.examenId }, orderBy: { orden: 'asc' } });
    return {
      ahora: new Date().toISOString(), // para que el cliente corrija la diferencia de reloj
      expiraEn: intento.expiraEn,
      borrador: intento.borrador,
      antiCheat: antiCheatActivo(ec.examen.antiCheat),
      preguntas: preguntas.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        enunciado: p.enunciado,
        puntajeMaximo: p.puntajeMaximo,
        opciones: sanitizarOpcionesParaAlumno(p.tipo, p.opciones),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Autoguardado, eventos y entrega (autenticados con el token del intento)
  // ---------------------------------------------------------------------------
  async guardarBorrador(intentoId: string, respuestas: Record<string, unknown>) {
    const intento = await this.intentoActivo(intentoId);
    const limpio = await this.filtrarPorPreguntas(intento.examenId, respuestas);
    this.validarTamano(limpio, 'El borrador');
    const guardadoEn = new Date();
    await this.prisma.intentoExamen.update({
      where: { id: intentoId },
      data: { borrador: limpio as any, borradorActualizadoEn: guardadoEn },
    });
    return { guardadoEn };
  }

  async registrarEvento(intentoId: string, dto: EventoIntegridadDto) {
    const intento = await this.intentoActivo(intentoId);
    const examen = await this.prisma.examen.findUniqueOrThrow({ where: { id: intento.examenId } });
    // Solo se registra lo que el docente activó Y el alumno aceptó al empezar.
    if (!eventoPermitido(antiCheatActivo(examen.antiCheat), dto.tipo)) return { registrado: false };
    const cantidad = await this.prisma.eventoIntegridad.count({ where: { intentoId } });
    if (cantidad >= MAX_EVENTOS_POR_INTENTO) return { registrado: false };
    await this.prisma.eventoIntegridad.create({ data: { intentoId, tipo: dto.tipo, detalle: dto.detalle } });
    return { registrado: true };
  }

  async entregar(intentoId: string, respuestas?: Record<string, unknown>) {
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado !== 'en_curso') throw new ConflictException('Este examen ya fue entregado');

    const tarde = this.estaVencido(intento, GRACIA_ENTREGA_MS);
    // Pasado el margen no se acepta contenido nuevo del cliente: vale lo último autoguardado.
    const contenido = !tarde && respuestas ? await this.filtrarPorPreguntas(intento.examenId, respuestas) : undefined;
    if (contenido) this.validarTamano(contenido, 'La entrega');
    const r = await this.finalizar(intentoId, contenido, tarde ? 'vencido' : 'entregado');
    return { recibida: true, enviadoEn: r?.createdAt ?? new Date(), aTiempo: !tarde };
  }

  // ---------------------------------------------------------------------------
  // Cierre de intentos (entrega del alumno, vencimiento o barrido)
  // ---------------------------------------------------------------------------
  /** Convierte el intento en una respuesta (una sola vez, aunque lleguen dos pedidos a la vez). */
  async finalizar(intentoId: string, contenido?: Record<string, unknown>, estado: 'entregado' | 'vencido' = 'vencido') {
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: intentoId } });
    if (!intento) return null;

    // "Reclamo" atómico: solo un pedido pasa de en_curso a cerrado.
    const reclamado = await this.prisma.intentoExamen.updateMany({
      where: { id: intentoId, estado: 'en_curso' },
      data: { estado, entregadoEn: new Date() },
    });
    if (reclamado.count === 0) return null;

    const final = contenido ?? (intento.borrador as Record<string, unknown>);
    return this.respuestas.crearDesdeContenido(intento.examenId, intento.alumnoId, final);
  }

  /** Cierra los intentos vencidos (pasado el margen). Lo llama el barrido y la vista del docente. */
  async cerrarVencidos(examenId?: string) {
    const limite = new Date(Date.now() - GRACIA_ENTREGA_MS);
    const vencidos = await this.prisma.intentoExamen.findMany({
      where: { estado: 'en_curso', expiraEn: { lt: limite }, ...(examenId ? { examenId } : {}) },
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
  // Token del intento (aislado del token de docente: typ 'intento')
  // ---------------------------------------------------------------------------
  private async firmarToken(intento: { id: string; expiraEn: Date | null }) {
    const restanteS = intento.expiraEn ? Math.ceil((intento.expiraEn.getTime() - Date.now() + GRACIA_ENTREGA_MS) / 1000) : 7 * 24 * 3600;
    return this.jwt.signAsync({ sub: intento.id, typ: 'intento' }, { expiresIn: Math.max(restanteS, 60) });
  }

  /** Valida el Bearer del alumno y que el intento sea de este link. Devuelve el id del intento. */
  async intentoDeToken(authorization: string | undefined, slug: string): Promise<string> {
    const [tipo, token] = (authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token del examen');
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('La sesión del examen venció. Volvé a ingresar con tu email y código.');
    }
    if (payload.typ !== 'intento') throw new UnauthorizedException('Token inválido');

    const ec = await this.examenComision(slug);
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: payload.sub }, include: { alumno: true } });
    if (!intento || intento.examenId !== ec.examenId || intento.alumno.comisionId !== ec.comisionId) {
      throw new ForbiddenException('Este intento no corresponde a este examen');
    }
    return intento.id;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  private async examenComision(slug: string) {
    const ec = await this.prisma.examenComision.findUnique({
      where: { slugAcceso: slug },
      include: { examen: true, comision: true },
    });
    if (!ec) throw new NotFoundException('Link de acceso inválido');
    return ec;
  }

  private validarVentana(ec: { fechaInicio: Date | null; fechaFin: Date | null }) {
    const ahora = new Date();
    if (ec.fechaInicio && ahora < ec.fechaInicio) throw new BadRequestException('Todavía no se abrió la ventana de entrega de este examen');
    if (ec.fechaFin && ahora > ec.fechaFin) throw new BadRequestException('La ventana de entrega de este examen ya cerró');
  }

  private estaVencido(intento: { expiraEn: Date | null }, margenMs = 0): boolean {
    return !!intento.expiraEn && Date.now() > intento.expiraEn.getTime() + margenMs;
  }

  /** Intento en curso y no vencido; si venció lo cierra (entregando el borrador) y avisa. */
  private async intentoActivo(intentoId: string) {
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estado !== 'en_curso') throw new ConflictException('Este examen ya fue entregado');
    if (this.estaVencido(intento, GRACIA_ENTREGA_MS)) {
      await this.finalizar(intento.id);
      throw new ConflictException('El tiempo de este examen terminó. Lo que alcanzaste a completar se entregó.');
    }
    return intento;
  }

  private validarTamano(contenido: Record<string, unknown>, que: string) {
    if (Buffer.byteLength(JSON.stringify(contenido)) > MAX_CONTENIDO_BYTES) {
      throw new BadRequestException(`${que} es demasiado grande (el máximo es ${Math.round(MAX_CONTENIDO_BYTES / 1000)} KB de texto en total)`);
    }
  }

  /** Descarta claves que no sean preguntas de este examen (el cliente no decide qué se guarda). */
  private async filtrarPorPreguntas(examenId: string, respuestas: Record<string, unknown>) {
    const ids = new Set((await this.prisma.pregunta.findMany({ where: { examenId }, select: { id: true } })).map((p) => p.id));
    return Object.fromEntries(Object.entries(respuestas).filter(([k]) => ids.has(k)));
  }
}
