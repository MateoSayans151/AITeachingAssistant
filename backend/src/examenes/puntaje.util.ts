// Reglas del puntaje de un examen: funciones puras (sin base de datos) para poder testearlas solas.
//
// El puntaje total del examen tiene que ser igual a la escala máxima: así la nota de un alumno (la suma de lo que sacó en
// cada pregunta) nunca se pasa de la escala. Puntaje efectivo de una pregunta: las cerradas valen su `puntajeMaximo`;
// las abiertas valen la SUMA del `puntajeMaximo` de sus criterios (es lo que reparte la rúbrica y lo que puede sacar el alumno).
import { TIPOS_AUTOCORREGIBLES } from './dto/create-examen.dto';

export interface PreguntaPuntaje {
  tipo: string;
  puntajeMaximo: number;
  criterios?: Array<{ puntajeMaximo: number }> | null;
}

// Diferencia máxima que se perdona entre dos puntajes (ruido de coma flotante o un centésimo de punto).
export const TOLERANCIA_PUNTAJE = 0.01;

/** Redondea a 2 decimales para que 0,1 + 0,2 sea 0,3 y no 0,30000000000000004. */
export const redondearPuntaje = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const sumar = (nums: number[]) => redondearPuntaje(nums.reduce((acc, n) => acc + n, 0));

/** Dos puntajes son "el mismo" si, redondeados a 2 decimales, difieren en la tolerancia o menos. */
export const mismoPuntaje = (a: number, b: number) =>
  Math.abs(redondearPuntaje(a) - redondearPuntaje(b)) <= TOLERANCIA_PUNTAJE + 1e-9;

/** 10.5 → "10,5": los mensajes son para el docente y el resto de la pantalla usa coma decimal. */
const mostrar = (n: number) => String(redondearPuntaje(n)).replace('.', ',');

/** Suma de los puntajes de los criterios de una pregunta (0 si no tiene). */
export function puntajeDeCriterios(pregunta: Pick<PreguntaPuntaje, 'criterios'>): number {
  return sumar((pregunta.criterios ?? []).map((c) => Number(c.puntajeMaximo)));
}

/** Cuánto puede sacar un alumno en la pregunta: cerradas → su puntaje; abiertas → la suma de sus criterios. */
export function puntajeEfectivo(pregunta: PreguntaPuntaje): number {
  return TIPOS_AUTOCORREGIBLES.includes(pregunta.tipo) ? redondearPuntaje(Number(pregunta.puntajeMaximo)) : puntajeDeCriterios(pregunta);
}

/** Lo que suma el examen entero con el puntaje efectivo de cada pregunta. */
export function puntajeTotalExamen(preguntas: PreguntaPuntaje[]): number {
  return sumar(preguntas.map(puntajeEfectivo));
}

/**
 * Devuelve el mensaje del primer problema de puntajes o null si todo cierra:
 *  (a) cada pregunta abierta declara un puntaje igual a la suma de sus criterios;
 *  (b) el total del examen es igual a la escala máxima.
 */
export function validarPuntajes(preguntas: PreguntaPuntaje[], escalaMax: number): string | null {
  for (const [i, p] of preguntas.entries()) {
    if (TIPOS_AUTOCORREGIBLES.includes(p.tipo)) continue;
    const suma = puntajeDeCriterios(p);
    if (!mismoPuntaje(p.puntajeMaximo, suma)) {
      return `La pregunta ${i + 1}: el puntaje (${mostrar(p.puntajeMaximo)}) tiene que ser la suma de los puntajes de sus criterios (${mostrar(suma)}).`;
    }
  }
  const total = puntajeTotalExamen(preguntas);
  if (!mismoPuntaje(total, escalaMax)) {
    return `El puntaje total del examen (${mostrar(total)}) tiene que ser igual a la escala máxima (${mostrar(escalaMax)}). Ajustá los puntajes o la escala.`;
  }
  return null;
}
