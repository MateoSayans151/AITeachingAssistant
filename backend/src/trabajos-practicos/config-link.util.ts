import { BadRequestException } from '@nestjs/common';
import { ModalidadLink } from './dto/create-trabajo-practico.dto';

// Una sesión más larga que esto es un plazo de varios días: para eso está el horario fijo.
export const MAX_DURACION_MINUTOS = 24 * 60;

export interface ConfigLink {
  modoSeguro: boolean;
  duracionMinutos: number | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
}

/**
 * Qué se guarda en el TP según la modalidad elegida (lo que no corresponde queda en null, así la
 * modalidad se deduce sin otra columna: con duración = ventana de tiempo, con fechas = horario fijo).
 * Es la regla de negocio que los decorators del DTO no pueden expresar porque cruza campos.
 */
export function resolverConfigLink(
  dto: { modalidad: ModalidadLink; modoSeguro?: boolean; duracionMinutos?: number; fechaInicio?: string; fechaFin?: string },
  ahora = new Date(),
): ConfigLink {
  const modoSeguro = dto.modoSeguro === true;

  if (dto.modalidad === 'ventana_tiempo') {
    const minutos = dto.duracionMinutos;
    if (minutos === undefined || minutos < 1 || minutos > MAX_DURACION_MINUTOS) {
      throw new BadRequestException(`La ventana de tiempo tiene que ser de entre 1 y ${MAX_DURACION_MINUTOS} minutos`);
    }
    return { modoSeguro, duracionMinutos: minutos, fechaInicio: null, fechaFin: null };
  }

  if (!dto.fechaInicio || !dto.fechaFin) {
    throw new BadRequestException('El horario fijo necesita fecha de inicio y de vencimiento');
  }
  const fechaInicio = new Date(dto.fechaInicio);
  const fechaFin = new Date(dto.fechaFin);
  if (fechaFin <= fechaInicio) throw new BadRequestException('El vencimiento tiene que ser posterior al inicio');
  if (fechaFin <= ahora) throw new BadRequestException('El vencimiento ya pasó');
  return { modoSeguro, duracionMinutos: null, fechaInicio, fechaFin };
}
