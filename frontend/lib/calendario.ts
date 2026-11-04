// Lógica del selector de fecha y hora propio (app/components/SelectorFecha.tsx): el valor es el mismo texto que usa <input type="datetime-local">
// ("2026-11-03T21:19", hora local), así las pantallas lo cambian sin tocar nada más. Funciones puras, sin React ni zonas horarias, para
// testearlas solas (backend/test/selectores.test.ts).

export interface FechaHora {
  año: number;
  /** 0 a 11, como en Date. */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** "2026-11-03T21:19" → sus partes; null si no es una fecha y hora válidas (incluye 31 de abril o 30 de febrero). */
export function parsearFechaHora(valor: string | null | undefined): FechaHora | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor ?? '');
  if (!m) return null;
  const [año, mes, dia, hora, minuto] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])];
  const f = new Date(año, mes, dia, hora, minuto);
  if (f.getFullYear() !== año || f.getMonth() !== mes || f.getDate() !== dia || hora > 23 || minuto > 59) return null;
  return { año, mes, dia, hora, minuto };
}

export function formatearFechaHora(f: FechaHora): string {
  return `${String(f.año).padStart(4, '0')}-${dos(f.mes + 1)}-${dos(f.dia)}T${dos(f.hora)}:${dos(f.minuto)}`;
}

/** "03/11/2026 21:19": como se lee en Argentina; vacío si no hay fecha. */
export function fechaHoraLegible(valor: string | null | undefined): string {
  const f = parsearFechaHora(valor);
  return f ? `${dos(f.dia)}/${dos(f.mes + 1)}/${f.año} ${dos(f.hora)}:${dos(f.minuto)}` : '';
}

export interface DiaDeLaGrilla {
  año: number;
  mes: number;
  dia: number;
  /** false: es de la semana del mes anterior o del siguiente que completa la grilla. */
  delMes: boolean;
}

/** Las 6 semanas (42 días) que muestra el calendario de un mes, empezando en lunes. */
export function diasDelMes(año: number, mes: number): DiaDeLaGrilla[] {
  const primero = new Date(año, mes, 1);
  const lunesPrimero = (primero.getDay() + 6) % 7; // 0 = lunes
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(año, mes, 1 - lunesPrimero + i);
    return { año: d.getFullYear(), mes: d.getMonth(), dia: d.getDate(), delMes: d.getMonth() === mes };
  });
}

/** "noviembre de 2026". */
export function nombreDelMes(año: number, mes: number): string {
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(año, mes, 1));
}

/** El mes anterior (-1) o siguiente (1), cruzando el cambio de año. */
export function moverMes(año: number, mes: number, delta: number): { año: number; mes: number } {
  const d = new Date(año, mes + delta, 1);
  return { año: d.getFullYear(), mes: d.getMonth() };
}

/** El día `delta` días después (o antes) de uno dado, cruzando meses y años. */
export function moverDia(f: Pick<FechaHora, 'año' | 'mes' | 'dia'>, delta: number): Pick<FechaHora, 'año' | 'mes' | 'dia'> {
  const d = new Date(f.año, f.mes, f.dia + delta);
  return { año: d.getFullYear(), mes: d.getMonth(), dia: d.getDate() };
}

export const mismoDia = (a: Pick<FechaHora, 'año' | 'mes' | 'dia'>, b: Pick<FechaHora, 'año' | 'mes' | 'dia'>) => a.año === b.año && a.mes === b.mes && a.dia === b.dia;

/** Compara solo la fecha (sin la hora): negativo si `a` es anterior a `b`. */
export function compararDias(a: Pick<FechaHora, 'año' | 'mes' | 'dia'>, b: Pick<FechaHora, 'año' | 'mes' | 'dia'>): number {
  return new Date(a.año, a.mes, a.dia).getTime() - new Date(b.año, b.mes, b.dia).getTime();
}

/** Lo que se escribe en un casillero de hora o minutos, llevado al rango válido (vacío o basura: `porDefecto`). */
export function acotarNumero(texto: string, max: number, porDefecto: number): number {
  const n = Number(texto.replace(/\D/g, '').slice(0, 2));
  if (texto.replace(/\D/g, '') === '' || !Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(n, 0), max);
}

export const NOMBRES_DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
