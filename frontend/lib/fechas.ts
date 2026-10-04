/** Valor de <input type="datetime-local"> ("2026-10-01T09:00", hora local) -> ISO para la API. */
export function fechaLocalAIso(valor: string): string | undefined {
  if (!valor) return undefined;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
