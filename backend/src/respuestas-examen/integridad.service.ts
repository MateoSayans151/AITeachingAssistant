import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AntiCheatConfig } from './anticheat.util';
import { ALMACEN_CAPTURAS, AlmacenCapturas } from './almacen-capturas';
import { CapturaDto, LatidoDto } from './dto/intento.dto';

// Todo lo que el servidor deduce o decide por su cuenta durante el examen (lo que el cliente no puede apagar sin dejar rastro):
//   - latido: si faltan latidos queda un hueco medible, y cada latido trae la marca visible que rota;
//   - capturas de pantalla dirigidas por el servidor: él decide cuándo hace falta una; si el cliente la ignora, queda anotado;
//   - revisión del docente: listar, ver y borrar capturas (y el borrado automático al vencer la retención).

export const MAX_EVENTOS_POR_INTENTO = 500;
/** Sin latidos por más de esto, se anota un hueco. El cliente late cada ~15 s. */
export const HUECO_LATIDO_MS = 60_000;
/** Entre capturas de muestreo (el promedio es 7 minutos). */
export const MUESTREO_MIN_MS = 4 * 60_000;
export const MUESTREO_MAX_MS = 10 * 60_000;
/** Cuánto se espera una captura pedida antes de darla por omitida. */
export const ESPERA_CAPTURA_MS = 90_000;
export const MAX_CAPTURAS_POR_INTENTO = 60;
/** De ese tope, las que dispara un evento no pueden pasar de esto: el resto queda reservado para el muestreo. */
export const MAX_CAPTURAS_DE_EVENTO = 40;
export const MAX_BYTES_CAPTURA = 300_000;
export const RETENCION_DIAS_POR_DEFECTO = 7;
const PREFIJO_JPEG = 'data:image/jpeg;base64,';
const ALFABETO_MARCA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I: se tiene que poder leer en una captura

export const jitterMuestreo = () => randomInt(MUESTREO_MIN_MS, MUESTREO_MAX_MS + 1);

export function generarMarca(): string {
  let m = '';
  for (let i = 0; i < 4; i++) m += ALFABETO_MARCA[randomInt(0, ALFABETO_MARCA.length)];
  return m;
}

/** Decodifica "data:image/jpeg;base64,..." y comprueba que sea un JPEG de tamaño razonable. */
export function decodificarJpeg(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PREFIJO_JPEG)) throw new BadRequestException('La captura tiene que ser un JPEG');
  const datos = Buffer.from(dataUrl.slice(PREFIJO_JPEG.length), 'base64');
  if (datos.length < 200 || datos[0] !== 0xff || datos[1] !== 0xd8 || datos[2] !== 0xff) throw new BadRequestException('La captura no es una imagen válida');
  if (datos.length > MAX_BYTES_CAPTURA) throw new BadRequestException('La captura es demasiado grande');
  return datos;
}

export interface EventoServidor {
  tipo: 'salto_de_texto' | 'cambio_de_origen' | 'captura_omitida' | 'latido_perdido' | 'cambio_pestana';
  detalle?: string;
}

@Injectable()
export class IntegridadService {
  private readonly logger = new Logger(IntegridadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ALMACEN_CAPTURAS) private readonly almacen: AlmacenCapturas,
  ) {}

  /** Cuántos días se guardan las capturas (se le dice al alumno antes de empezar). */
  get retencionDias(): number {
    const n = Number(this.config.get<string>('CAPTURAS_RETENCION_DIAS'));
    return Number.isFinite(n) && n > 0 ? n : RETENCION_DIAS_POR_DEFECTO;
  }

  /** Anota eventos que deduce el servidor, respetando el tope de eventos por intento. */
  async anotar(intentoId: string, eventos: EventoServidor[]): Promise<void> {
    if (eventos.length === 0) return;
    const cantidad = await this.prisma.eventoIntegridad.count({ where: { intentoId } });
    const lugar = MAX_EVENTOS_POR_INTENTO - cantidad;
    if (lugar <= 0) return;
    await this.prisma.eventoIntegridad.createMany({
      data: eventos.slice(0, lugar).map((e) => ({ intentoId, tipo: e.tipo, detalle: e.detalle?.slice(0, 200) })),
    });
  }

  // ---------------------------------------------------------------------------------------------------------------- latido
  async latido(
    intento: {
      id: string;
      ultimoLatidoEn: Date | null;
      proximaCapturaEn: Date | null;
      capturaPedidaId: string | null;
      capturaPedidaEn: Date | null;
      marcaActual: string | null;
    },
    cfg: AntiCheatConfig | null,
    dto: LatidoDto,
    ahora = new Date(),
  ) {
    const t = ahora.getTime();
    const eventos: EventoServidor[] = [];
    const data: Record<string, unknown> = { ultimoLatidoEn: ahora };

    if (cfg) {
      if (intento.ultimoLatidoEn && t - intento.ultimoLatidoEn.getTime() > HUECO_LATIDO_MS) {
        eventos.push({ tipo: 'latido_perdido', detalle: `${Math.round((t - intento.ultimoLatidoEn.getTime()) / 1000)} s sin señal del navegador` });
      }
      // El latido también cuenta si el navegador dice que no tiene el foco: sirve aunque el alumno haya apagado los listeners.
      if (cfg.cambioPestana && (!dto.foco || !dto.visible)) {
        const reciente = await this.prisma.eventoIntegridad.count({
          where: { intentoId: intento.id, tipo: 'cambio_pestana', ocurridoEn: { gte: new Date(t - 20_000) } },
        });
        if (reciente === 0) eventos.push({ tipo: 'cambio_pestana', detalle: 'detectado por el latido' });
      }
    }

    // La marca rota en cada latido: la anterior sigue valiendo (la captura puede haberse tomado justo antes).
    const marca = generarMarca();
    data.marcaAnterior = intento.marcaActual;
    data.marcaActual = marca;

    let pedido: { id: string } | null = null;
    if (cfg?.pantallaCompartida) {
      if (!intento.proximaCapturaEn) {
        data.proximaCapturaEn = new Date(t + jitterMuestreo());
      } else if (intento.capturaPedidaId) {
        if (intento.capturaPedidaEn && t - intento.capturaPedidaEn.getTime() > ESPERA_CAPTURA_MS) {
          // El cliente ignoró el pedido (o no puede capturar): queda anotado y se reprograma.
          eventos.push({ tipo: 'captura_omitida', detalle: 'el navegador no envió la captura pedida' });
          data.capturaPedidaId = null;
          data.capturaPedidaEn = null;
          data.proximaCapturaEn = new Date(t + jitterMuestreo());
        } else {
          pedido = { id: intento.capturaPedidaId };
        }
      } else if (t >= intento.proximaCapturaEn.getTime()) {
        const id = randomUUID();
        data.capturaPedidaId = id;
        data.capturaPedidaEn = ahora;
        pedido = { id };
      }
    }

    await this.prisma.intentoExamen.update({ where: { id: intento.id }, data });
    await this.anotar(intento.id, eventos);
    return { marca, capturaPedida: pedido, ahora: ahora.toISOString() };
  }

  // -------------------------------------------------------------------------------------------------------------- capturas
  async registrarCaptura(
    intento: { id: string; capturaPedidaId: string | null; marcaActual: string | null; marcaAnterior: string | null },
    cfg: AntiCheatConfig | null,
    dto: CapturaDto,
    ahora = new Date(),
  ): Promise<{ registrada: boolean; motivo?: string }> {
    if (!cfg?.pantallaCompartida) return { registrada: false, motivo: 'no_activo' };
    const datos = decodificarJpeg(dto.imagen);

    const total = await this.prisma.capturaIntegridad.count({ where: { intentoId: intento.id } });
    if (total >= MAX_CAPTURAS_POR_INTENTO) return { registrada: false, motivo: 'tope' };

    const esMuestreo = dto.motivo === 'muestreo';
    if (esMuestreo) {
      // Solo se acepta la que el servidor pidió (y una sola vez): no se pueden "regalar" capturas viejas o fabricadas a destiempo.
      if (!dto.pedidoId || dto.pedidoId !== intento.capturaPedidaId) return { registrada: false, motivo: 'sin_pedido' };
    } else {
      const deEvento = await this.prisma.capturaIntegridad.count({ where: { intentoId: intento.id, motivo: { not: 'muestreo' } } });
      if (deEvento >= MAX_CAPTURAS_DE_EVENTO) return { registrada: false, motivo: 'tope_eventos' };
      // Hasta dos por evento y ventana de 20 s (el cliente toma una a +1,5 s y otra a +5 s): provocar eventos no llena el cupo.
      const recientes = await this.prisma.capturaIntegridad.count({
        where: { intentoId: intento.id, motivo: dto.motivo, ocurridoEn: { gte: new Date(ahora.getTime() - 20_000) } },
      });
      if (recientes >= 2) return { registrada: false, motivo: 'demasiado_seguido' };
    }

    const ruta = `${intento.id}/${randomUUID()}.jpg`;
    await this.almacen.guardar(ruta, datos);
    const marcaValida = !!dto.marca && (dto.marca === intento.marcaActual || dto.marca === intento.marcaAnterior);
    await this.prisma.capturaIntegridad.create({
      data: {
        intentoId: intento.id,
        ocurridoEn: ahora,
        motivo: dto.motivo,
        ruta,
        bytes: datos.length,
        marca: dto.marca,
        marcaValida,
        eliminarEn: new Date(ahora.getTime() + this.retencionDias * 24 * 3600_000),
      },
    });
    if (esMuestreo) {
      await this.prisma.intentoExamen.update({
        where: { id: intento.id },
        data: { capturaPedidaId: null, capturaPedidaEn: null, proximaCapturaEn: new Date(ahora.getTime() + jitterMuestreo()) },
      });
    }
    return { registrada: true };
  }

  // ---------------------------------------------------------------------------------------------------------------- docente
  /** El intento de la respuesta de un examen (el acceso del docente al examen ya se verificó antes). */
  async intentoIdDeRespuesta(examenId: string, respuestaId: string): Promise<string> {
    const r = await this.prisma.respuestaExamen.findUnique({ where: { id: respuestaId }, select: { examenId: true, alumnoId: true } });
    if (!r || r.examenId !== examenId) throw new NotFoundException('Respuesta no encontrada');
    const i = await this.prisma.intentoExamen.findUnique({ where: { examenId_alumnoId: { examenId, alumnoId: r.alumnoId } }, select: { id: true } });
    if (!i) throw new NotFoundException('Esta respuesta no tiene capturas');
    return i.id;
  }

  listarCapturas(intentoId: string) {
    return this.prisma.capturaIntegridad.findMany({
      where: { intentoId },
      orderBy: { ocurridoEn: 'asc' },
      select: { id: true, ocurridoEn: true, motivo: true, marca: true, marcaValida: true, bytes: true, eliminarEn: true },
    });
  }

  async leerCaptura(intentoId: string, capturaId: string): Promise<Buffer> {
    const c = await this.prisma.capturaIntegridad.findFirst({ where: { id: capturaId, intentoId } });
    if (!c) throw new NotFoundException('Captura no encontrada');
    const datos = await this.almacen.leer(c.ruta);
    if (!datos) throw new NotFoundException('La imagen de esta captura ya no está disponible');
    return datos;
  }

  async borrarCaptura(intentoId: string, capturaId: string): Promise<void> {
    const c = await this.prisma.capturaIntegridad.findFirst({ where: { id: capturaId, intentoId } });
    if (!c) throw new NotFoundException('Captura no encontrada');
    await this.almacen.borrar(c.ruta);
    await this.prisma.capturaIntegridad.delete({ where: { id: c.id } });
  }

  async borrarCapturas(intentoId: string): Promise<number> {
    const filas = await this.prisma.capturaIntegridad.findMany({ where: { intentoId }, select: { id: true, ruta: true } });
    for (const f of filas) await this.almacen.borrar(f.ruta);
    await this.prisma.capturaIntegridad.deleteMany({ where: { intentoId } });
    return filas.length;
  }

  /** Borra las imágenes y las filas cuya retención venció. Lo llama el barrido periódico. */
  async purgarVencidas(): Promise<number> {
    const vencidas = await this.prisma.capturaIntegridad.findMany({ where: { eliminarEn: { lt: new Date() } }, take: 200, select: { id: true, ruta: true } });
    for (const c of vencidas) {
      try {
        await this.almacen.borrar(c.ruta);
        await this.prisma.capturaIntegridad.delete({ where: { id: c.id } });
      } catch (e) {
        this.logger.error(`No se pudo borrar la captura vencida ${c.id}`, e as Error);
      }
    }
    return vencidas.length;
  }
}
