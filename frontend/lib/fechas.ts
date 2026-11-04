/** Valor de <input type="datetime-local"> ("2026-10-01T09:00", hora local) -> ISO para la API. */
export function fechaLocalAIso(valor: string): string | undefined {
  if (!valor) return undefined;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** ISO de la API -> valor de <input type="datetime-local"> en hora local ("2026-10-01T09:00"); vacío si no hay fecha. */
export function isoAFechaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
