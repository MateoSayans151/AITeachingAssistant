import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
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
import { CapturaDto, EventoIntegridadDto, IniciarIntentoDto, LatidoDto, SolicitarCodigoDto } from './dto/intento.dto';
import { generarCodigoAcceso } from '../comisiones/comisiones.service';
import { CodigosAccesoService, emailEnDominio, normalizarDominio } from './codigos-acceso.service';
import { EventoServidor, IntegridadService } from './integridad.service';

/** De dónde viene un pedido: la IP la saca Nest; el navegador y el id de pestaña los manda el cliente (son indicios, no pruebas). */
export interface Origen {
  ip?: string;
  userAgent?: string;
  clienteId?: string;
}

/** Un salto de texto: más de esto de golpe y más rápido de lo que se puede tipear. */
export const SALTO_MIN_CARACTERES = 300;
export const SALTO_MIN_CARACTERES_POR_SEGUNDO = 30;

/**
 * Compara el borrador anterior con el nuevo y devuelve las respuestas de texto que crecieron de golpe: mucho texto en muy poco
 * tiempo no se tipea. Es una señal que el cliente no puede suprimir (el autoguardado es lo que alimenta al servidor).
 */
export function saltosDeTexto(anterior: Record<string, unknown>, nuevo: Record<string, unknown>, transcurridoMs: number) {
  const segundos = Math.max(transcurridoMs, 1000) / 1000;
  const saltos: { preguntaId: string; caracteres: number }[] = [];
  for (const [id, valor] of Object.entries(nuevo)) {
    if (typeof valor !== 'string') continue;
    const previo = typeof anterior[id] === 'string' ? (anterior[id] as string).length : 0;
    const crecio = valor.length - previo;
    if (crecio >= SALTO_MIN_CARACTERES && crecio / segundos >= SALTO_MIN_CARACTERES_POR_SEGUNDO) saltos.push({ preguntaId: id, caracteres: crecio });
  }
  return saltos;
}

/** Margen para que llegue una entrega hecha justo al vencer (latencia, reloj del cliente). */
export const GRACIA_ENTREGA_MS = 20_000;
const MAX_EVENTOS_POR_INTENTO = 500;
const VENTANA_FALLOS_MS = 10 * 60_000;
const BARRIDO_VENCIDOS_MS = 60_000;
/** Tope de alumnos que se pueden sumar solos a una comisión con acceso abierto (frena a quien quiera llenar la comisión de cuentas falsas). */
export const MAX_ALUMNOS_ACCESO_ABIERTO = 1000;

/** "ana.perez@mail.com" -> "Ana Perez": nombre legible cuando el alumno no escribió el suyo. */
export function nombreDesdeEmail(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim() || email;
  return local.replace(/(^|\s)(\S)/g, (_, espacio: string, letra: string) => espacio + letra.toUpperCase());
}

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
    @Optional() private readonly codigos?: CodigosAccesoService,
    @Optional() private readonly integridad?: IntegridadService,
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
      this.codigos?.purgar().catch((e) => this.logger.error('Falló la limpieza de códigos de acceso', e as Error));
      this.integridad?.purgarVencidas().catch((e) => this.logger.error('Falló el borrado de capturas vencidas', e as Error));
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
        // Solo si el examen pide pantalla compartida: cuántos días se guardan las capturas.
        retencionCapturasDias: antiCheatActivo(ec.examen.antiCheat)?.pantallaCompartida ? (this.integridad?.retencionDias ?? null) : null,
      },
      comision: { nombre: ec.comision.nombre },
      // true: cualquier alumno con el link puede entrar (la pantalla le pide también el nombre); false: solo los de la lista.
      accesoAbierto: ec.accesoAbierto,
      // true: para entrar hay que pedir un código que llega al mail. dominioPermitido: solo mails de ese dominio pueden entrar.
      verificarEmail: ec.verificarEmail,
      dominioPermitido: normalizarDominio(ec.dominioPermitido),
      ventana: { estado: ventana, fechaInicio: ec.fechaInicio, fechaFin: ec.fechaFin },
    };
  }

  // ---------------------------------------------------------------------------
  // Iniciar (o retomar) el intento
  // ---------------------------------------------------------------------------
  /** Pide el código de acceso por mail. Siempre responde lo mismo, esté o no el mail en la lista. */
  async solicitarCodigo(slug: string, dto: SolicitarCodigoDto, ip: string) {
    const ec = await this.examenComision(slug);
    if (!ec.verificarEmail) throw new BadRequestException('Este examen no usa código: ingresá directamente con tu mail.');
    if (!this.codigos) throw new ServiceUnavailableException('La verificación por mail no está disponible en este momento.');
    await this.codigos.solicitar(ec, dto.alumnoEmail, ip);
    return { enviado: true };
  }

  async iniciar(slug: string, dto: IniciarIntentoDto, ip: string, origen: Omit<Origen, 'ip'> = {}) {
    const ec = await this.examenComision(slug);
    const claveIp = `ip|${ip}`;
    await this.fallosPorIp.verificar(claveIp);

    if (ec.verificarEmail) {
      // Primero se prueba que el alumno tiene el buzón; recién después se lo busca (o se lo crea, con acceso abierto).
      if (!this.codigos) throw new ServiceUnavailableException('La verificación por mail no está disponible en este momento.');
      await this.codigos.consumir(ec, dto.alumnoEmail, dto.codigo, ip);
    }

    const alumno = await this.resolverAlumno(ec, dto, claveIp);

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

    // Cada inicio de sesión sube el contador: con verificación de mail, el token de la sesión anterior deja de valer.
    const ua = origen.userAgent?.slice(0, 300);
    const actualizado = await this.prisma.intentoExamen.update({
      where: { id: intento.id },
      data: { sesion: { increment: 1 }, ultimoOrigenIp: ip, ultimoOrigenUa: ua, ultimoClienteId: origen.clienteId?.slice(0, 64) },
      select: { sesion: true },
    });
    await this.prisma.sesionIntento.create({ data: { intentoId: intento.id, ip, userAgent: ua } });

    return { token: await this.firmarToken(intento, actualizado.sesion), ...(await this.estadoIntento(intento.id, slug)) };
  }

  /**
   * El alumno que entra con ese email. Se identifica solo con su email (sin distinguir mayúsculas: también encuentra a quien quedó
   * cargado como "Ana@Mail.com"). Si no figura en la comisión:
   *  - con acceso abierto se lo agrega solo, con el nombre que escribió (o uno armado con su email), siempre que la ventana del
   *    examen esté abierta y la comisión no haya llegado al tope;
   *  - si no, se rechaza, y el freno por IP limita que alguien pruebe emails al azar para ver quién está en la comisión.
   */
  async resolverAlumno(
    ec: { comisionId: string; accesoAbierto: boolean; fechaInicio: Date | null; fechaFin: Date | null; dominioPermitido?: string | null },
    dto: IniciarIntentoDto,
    claveIp: string,
  ) {
    const buscar = () =>
      this.prisma.alumno.findFirst({ where: { comisionId: ec.comisionId, email: { equals: dto.alumnoEmail, mode: 'insensitive' } } });
    const existente = await buscar();
    if (existente) return existente;

    if (!ec.accesoAbierto) {
      await this.fallosPorIp.fallo(claveIp);
      throw new UnauthorizedException('Ese email no está en el listado de esta comisión. Revisalo o consultá con tu docente.');
    }

    // Un examen cerrado o que todavía no abrió no suma alumnos nuevos.
    this.validarVentana(ec);
    if (!emailEnDominio(dto.alumnoEmail, ec.dominioPermitido)) {
      throw new BadRequestException(`Para rendir este examen tenés que usar un mail de @${normalizarDominio(ec.dominioPermitido)}.`);
    }
    const cantidad = await this.prisma.alumno.count({ where: { comisionId: ec.comisionId } });
    if (cantidad >= MAX_ALUMNOS_ACCESO_ABIERTO) {
      throw new ConflictException('Este examen llegó al máximo de alumnos que pueden entrar. Avisale a tu docente.');
    }
    try {
      return await this.prisma.alumno.create({
        data: {
          comisionId: ec.comisionId,
          nombre: dto.alumnoNombre?.trim() || nombreDesdeEmail(dto.alumnoEmail),
          email: dto.alumnoEmail,
          codigoAcceso: generarCodigoAcceso(),
        },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e; // dos pestañas entrando a la vez con el mismo email: nos quedamos con el que ganó
      const ganador = await buscar();
      if (!ganador) throw e;
      return ganador;
    }
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
        opciones: sanitizarOpcionesParaAlumno(p.tipo, p.opciones, p.id),
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
    await this.anotarSaltosDeTexto(intento, limpio, guardadoEn);
    await this.prisma.intentoExamen.update({
      where: { id: intentoId },
      data: { borrador: limpio as any, borradorActualizadoEn: guardadoEn },
    });
    return { guardadoEn };
  }

  /** Si el examen monitorea, anota las respuestas que crecieron de golpe (ver `saltosDeTexto`). */
  private async anotarSaltosDeTexto(
    intento: { id: string; examenId: string; borrador: unknown; borradorActualizadoEn: Date | null; inicioEn: Date },
    nuevo: Record<string, unknown>,
    ahora: Date,
  ) {
    if (!this.integridad) return;
    try {
      const anterior = (intento.borrador ?? {}) as Record<string, unknown>;
      const desde = (intento.borradorActualizadoEn ?? intento.inicioEn).getTime();
      const saltos = saltosDeTexto(anterior, nuevo, ahora.getTime() - desde);
      if (saltos.length === 0) return;
      const examen = await this.prisma.examen.findUnique({ where: { id: intento.examenId }, select: { antiCheat: true } });
      if (!antiCheatActivo(examen?.antiCheat)) return; // sin monitoreo (ni consentimiento) no se anota nada
      await this.integridad.anotar(
        intento.id,
        saltos.map<EventoServidor>((j) => ({ tipo: 'salto_de_texto', detalle: `pregunta ${j.preguntaId}: +${j.caracteres} caracteres de golpe` })),
      );
    } catch (e) {
      this.logger.warn(`No se pudo evaluar el salto de texto: ${(e as Error).message}`); // nunca debe romper el autoguardado
    }
  }

  async latido(intentoId: string, dto: LatidoDto) {
    const intento = await this.intentoActivo(intentoId);
    const examen = await this.prisma.examen.findUniqueOrThrow({ where: { id: intento.examenId }, select: { antiCheat: true } });
    if (!this.integridad) return { marca: null, capturaPedida: null, ahora: new Date().toISOString() };
    return this.integridad.latido(intento, antiCheatActivo(examen.antiCheat), dto);
  }

  async subirCaptura(intentoId: string, dto: CapturaDto) {
    const intento = await this.intentoActivo(intentoId);
    const examen = await this.prisma.examen.findUniqueOrThrow({ where: { id: intento.examenId }, select: { antiCheat: true } });
    if (!this.integridad) return { registrada: false };
    return this.integridad.registrarCaptura(intento, antiCheatActivo(examen.antiCheat), dto);
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
  private async firmarToken(intento: { id: string; expiraEn: Date | null }, sesion: number) {
    const restanteS = intento.expiraEn ? Math.ceil((intento.expiraEn.getTime() - Date.now() + GRACIA_ENTREGA_MS) / 1000) : 7 * 24 * 3600;
    // `ses` es la sesión a la que pertenece el token (ver `intentoDeToken`).
    return this.jwt.signAsync({ sub: intento.id, typ: 'intento', ses: sesion }, { expiresIn: Math.max(restanteS, 60) });
  }

  /** Valida el Bearer del alumno y que el intento sea de este link. Devuelve el id del intento. */
  async intentoDeToken(authorization: string | undefined, slug: string, origen?: Origen): Promise<string> {
    const [tipo, token] = (authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token del examen');
    let payload: { sub: string; typ?: string; ses?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('La sesión del examen venció. Volvé a ingresar con tu email.');
    }
    if (payload.typ !== 'intento') throw new UnauthorizedException('Token inválido');

    const ec = await this.examenComision(slug);
    const intento = await this.prisma.intentoExamen.findUnique({ where: { id: payload.sub }, include: { alumno: true } });
    if (!intento || intento.examenId !== ec.examenId || intento.alumno.comisionId !== ec.comisionId) {
      throw new ForbiddenException('Este intento no corresponde a este examen');
    }
    // Sesión única (solo con verificación de mail: sin ella, cualquiera que supiera un mail podría sacar al alumno de su examen).
    // Un token sin `ses` (emitido antes de esta versión) vale como sesión 0.
    if (ec.verificarEmail && (payload.ses ?? 0) !== intento.sesion) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        codigo: 'SESION_REEMPLAZADA',
        message: 'Abriste este examen en otro lugar: esta sesión se cerró. Lo que escribiste antes está guardado.',
      });
    }
    if (origen) await this.seguirOrigen(intento, ec.examen.antiCheat, origen);
    return intento.id;
  }

  /**
   * Si el pedido viene de otra IP, otro navegador u otra pestaña/dispositivo que el anterior, queda anotado: es lo que pasa cuando
   * se copia el token a otro equipo (la sesión única no lo ve, porque no hay un login nuevo). Es un indicio: la IP cambia sola al
   * pasar de wifi a datos.
   */
  private async seguirOrigen(
    intento: { id: string; ultimoOrigenIp: string | null; ultimoOrigenUa: string | null; ultimoClienteId: string | null },
    antiCheat: unknown,
    origen: Origen,
  ) {
    const ua = origen.userAgent?.slice(0, 300);
    const cliente = origen.clienteId?.slice(0, 64);
    const cambios: string[] = [];
    if (origen.ip && intento.ultimoOrigenIp && origen.ip !== intento.ultimoOrigenIp) cambios.push('IP');
    if (ua && intento.ultimoOrigenUa && ua !== intento.ultimoOrigenUa) cambios.push('navegador');
    if (cliente && intento.ultimoClienteId && cliente !== intento.ultimoClienteId) cambios.push('pestaña o dispositivo');
    const primera = (!intento.ultimoOrigenIp && origen.ip) || (!intento.ultimoClienteId && cliente);
    if (cambios.length === 0 && !primera) return;
    try {
      await this.prisma.intentoExamen.update({
        where: { id: intento.id },
        data: { ultimoOrigenIp: origen.ip ?? intento.ultimoOrigenIp, ultimoOrigenUa: ua ?? intento.ultimoOrigenUa, ultimoClienteId: cliente ?? intento.ultimoClienteId },
      });
      if (cambios.length > 0 && this.integridad && antiCheatActivo(antiCheat)) {
        await this.integridad.anotar(intento.id, [{ tipo: 'cambio_de_origen', detalle: `cambió: ${cambios.join(', ')}` }]);
      }
    } catch (e) {
      this.logger.warn(`No se pudo seguir el origen del intento: ${(e as Error).message}`);
    }
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
