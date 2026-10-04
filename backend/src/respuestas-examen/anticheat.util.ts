export type AntiCheatConfig = { pantallaCompleta: boolean; cambioPestana: boolean; pegado: boolean };

/** Config normalizada del anti-cheat de un examen, o null si no tiene ningún control activo. */
export function antiCheatActivo(valor: unknown): AntiCheatConfig | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const cfg = { pantallaCompleta: v.pantallaCompleta === true, cambioPestana: v.cambioPestana === true, pegado: v.pegado === true };
  return cfg.pantallaCompleta || cfg.cambioPestana || cfg.pegado ? cfg : null;
}

/** Qué tipos de evento acepta el servidor según lo que el docente activó. */
export function eventoPermitido(cfg: AntiCheatConfig | null, tipo: string): boolean {
  if (!cfg) return false;
  if (tipo === 'salida_pantalla_completa') return cfg.pantallaCompleta;
  if (tipo === 'cambio_pestana') return cfg.cambioPestana;
  if (tipo === 'pegado') return cfg.pegado;
  return false;
}
