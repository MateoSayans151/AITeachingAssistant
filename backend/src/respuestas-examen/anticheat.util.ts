export type AntiCheatConfig = { pantallaCompleta: boolean; cambioPestana: boolean; pegado: boolean; pantallaCompartida: boolean };

/** Config normalizada del anti-cheat de un examen, o null si no tiene ningún control activo. */
export function antiCheatActivo(valor: unknown): AntiCheatConfig | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const cfg = {
    pantallaCompleta: v.pantallaCompleta === true,
    cambioPestana: v.cambioPestana === true,
    pegado: v.pegado === true,
    pantallaCompartida: v.pantallaCompartida === true,
  };
  return cfg.pantallaCompleta || cfg.cambioPestana || cfg.pegado || cfg.pantallaCompartida ? cfg : null;
}

/** Eventos que reporta el navegador del alumno (el servidor genera otros por su cuenta: ver EVENTOS_DEL_SERVIDOR). */
export const EVENTOS_DEL_CLIENTE = [
  'salida_pantalla_completa',
  'cambio_pestana',
  'pegado',
  'pantalla_compartida_detenida',
  'superficie_no_permitida',
  'monitor_extendido',
] as const;
export type EventoDelCliente = (typeof EVENTOS_DEL_CLIENTE)[number];

/** Señales que deduce el servidor (no las manda el cliente): salto de texto, cambio de origen, captura omitida, latido perdido. */
export const EVENTOS_DEL_SERVIDOR = ['salto_de_texto', 'cambio_de_origen', 'captura_omitida', 'latido_perdido'] as const;

/** Qué tipos de evento acepta el servidor según lo que el docente activó. */
export function eventoPermitido(cfg: AntiCheatConfig | null, tipo: string): boolean {
  if (!cfg) return false;
  if (tipo === 'salida_pantalla_completa') return cfg.pantallaCompleta;
  if (tipo === 'cambio_pestana') return cfg.cambioPestana;
  if (tipo === 'pegado') return cfg.pegado;
  if (tipo === 'pantalla_compartida_detenida' || tipo === 'superficie_no_permitida' || tipo === 'monitor_extendido') return cfg.pantallaCompartida;
  return false;
}
