import { TIPOS_AUTOCORREGIBLES } from './dto/create-examen.dto';

/**
 * Los criterios de una pregunta abierta son OPCIONALES. Para que todo lo que viene después (la corrección con IA, la revisión del
 * docente, la nota por criterio, la vara) siga funcionando igual, una pregunta abierta sin criterios se guarda con UN criterio
 * general que vale todos sus puntos: la IA evalúa la respuesta en conjunto contra el enunciado, sin detalle por nivel (usa la escala
 * del examen). El frontend reconoce este criterio por su nombre para no mostrarlo como si lo hubiera cargado el docente al duplicar
 * un examen (frontend/lib/examen-form.ts, NOMBRE_CRITERIO_GENERAL: si cambia acá hay que cambiarlo allá).
 */
export const NOMBRE_CRITERIO_GENERAL = 'Respuesta en general';
export const DESCRIPCION_CRITERIO_GENERAL = 'Qué tan correcta, completa y bien fundamentada es la respuesta, según lo que pide el enunciado.';

interface PreguntaConCriterios {
  tipo: string;
  puntajeMaximo: number;
  criterios?: Array<{ nombre: string; descripcion: string; puntajeMaximo: number; nivelesDescripcion?: unknown[]; matrizOrigenId?: string }>;
}

/** Las mismas preguntas, con el criterio general en cada abierta que no trajo criterios. No muta lo que recibe. */
export function conCriterioGeneral<T extends PreguntaConCriterios>(preguntas: T[]): T[] {
  return preguntas.map((p) => {
    if (TIPOS_AUTOCORREGIBLES.includes(p.tipo) || (p.criterios && p.criterios.length > 0)) return p;
    return {
      ...p,
      criterios: [{ nombre: NOMBRE_CRITERIO_GENERAL, descripcion: DESCRIPCION_CRITERIO_GENERAL, puntajeMaximo: p.puntajeMaximo, nivelesDescripcion: [] }],
    };
  });
}
