// Panel "En vivo" del docente: qué alumnos están rindiendo ahora y cómo van. Funciones puras (sin base de datos) para testearlas solas.

/** Un valor autoguardado cuenta como respondido si tiene algo: texto no vacío, una opción elegida, un par armado... */
export function tieneContenido(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (typeof valor === 'boolean') return true; // verdadero/falso: false también es una respuesta
  if (Array.isArray(valor)) return valor.some(tieneContenido);
  if (typeof valor === 'object') return Object.values(valor as Record<string, unknown>).some(tieneContenido);
  return false;
}

/** Cuántas de las preguntas del examen tienen algo escrito o elegido en el borrador (las claves ajenas al examen no cuentan). */
export function contarRespondidas(borrador: unknown, preguntaIds: string[]): number {
  if (!borrador || typeof borrador !== 'object') return 0;
  const b = borrador as Record<string, unknown>;
  return preguntaIds.filter((id) => tieneContenido(b[id])).length;
}

/** Cuándo se vio actividad del alumno por última vez: lo más reciente entre latido, autoguardado e inicio. */
export function ultimaActividad(intento: { inicioEn: Date; ultimoLatidoEn?: Date | null; borradorActualizadoEn?: Date | null }): Date {
  const fechas = [intento.inicioEn, intento.ultimoLatidoEn, intento.borradorActualizadoEn].filter((f): f is Date => !!f);
  return new Date(Math.max(...fechas.map((f) => f.getTime())));
}

/** Pasado este tiempo sin ninguna señal (el autoguardado y el latido llegan cada pocos segundos) se lo marca como "sin señal". */
export const SIN_SENAL_MS = 2 * 60_000;

export type Conexion = 'activo' | 'sin_senal';

export function estadoDeConexion(ultima: Date, ahora: Date): Conexion {
  return ahora.getTime() - ultima.getTime() > SIN_SENAL_MS ? 'sin_senal' : 'activo';
}

export interface FilaEnVivo {
  intentoId: string;
  alumnoId: string;
  nombre: string;
  email: string;
  comision: string;
  inicioEn: Date;
  expiraEn: Date | null;
  ultimaActividad: Date;
  conexion: Conexion;
  respondidas: number;
  totalPreguntas: number;
  /** Señales de integridad por tipo (solo las que ocurrieron). */
  senales: Record<string, number>;
  totalSenales: number;
  capturas: number;
}

/** Los que más atención piden primero: sin señal, después con más señales de integridad, después los que empezaron antes. */
export function ordenarEnVivo<T extends Pick<FilaEnVivo, 'conexion' | 'totalSenales' | 'inicioEn'>>(filas: T[]): T[] {
  const peso = (f: T) => (f.conexion === 'sin_senal' ? 0 : 1);
  return [...filas].sort((a, b) => peso(a) - peso(b) || b.totalSenales - a.totalSenales || a.inicioEn.getTime() - b.inicioEn.getTime());
}
