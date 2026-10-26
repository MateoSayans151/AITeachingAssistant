// Textos de la interfaz que se arman con números.

/** "1 alumno" / "3 alumnos": el número con su sustantivo en singular o plural. */
export function plural(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/**
 * Una nota o un puntaje en formato argentino: "6,5", "10", "0,25" (coma decimal, hasta 2 decimales, sin ceros de más). Acepta el
 * número o el string que entrega Prisma para los decimales; "—" si no hay valor.
 */
export function formatearNota(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);
}
