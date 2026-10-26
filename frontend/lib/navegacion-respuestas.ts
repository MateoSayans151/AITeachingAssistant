// Navegación entre las respuestas de un examen mientras el docente las revisa en tanda: dónde está parado, cuál es la anterior y la
// siguiente, y cuál es la próxima que todavía espera su revisión. Funciones puras (sin React ni red) para testearlas con node:test
// (backend/test/navegacion-respuestas.test.ts). La clasificación es la misma de la pantalla de respuestas.

export interface RespuestaDeLista {
  id: string;
  estado: 'pendiente_correccion' | 'corregido' | 'revisado';
  estadoRevision: 'pendiente' | 'aceptada' | 'editada';
}

/** La IA ya sugirió una nota y el docente todavía no la revisó: lo que hay que mirar. */
export const esParaRevisar = (r: Pick<RespuestaDeLista, 'estado' | 'estadoRevision'>): boolean =>
  r.estado !== 'pendiente_correccion' && r.estadoRevision === 'pendiente';

export interface Navegacion {
  /** Posición de la respuesta actual en la lista, base 1; null si no está en la lista. */
  posicion: number | null;
  total: number;
  anteriorId: string | null;
  siguienteId: string | null;
  /** La próxima respuesta por revisar después de la actual (da la vuelta al llegar al final); null si no queda ninguna otra. */
  siguienteParaRevisarId: string | null;
  /** Cuántas esperan revisión sin contar la actual. */
  restantesParaRevisar: number;
}

export function navegacion(lista: RespuestaDeLista[], actualId: string): Navegacion {
  const indice = lista.findIndex((r) => r.id === actualId);
  const otras = lista.filter((r) => r.id !== actualId && esParaRevisar(r));
  let siguienteParaRevisarId: string | null = null;
  if (otras.length > 0) {
    // Primero las que vienen después de la actual; si no hay, las de antes (da la vuelta).
    const despues = indice >= 0 ? lista.slice(indice + 1).find(esParaRevisar) : undefined;
    siguienteParaRevisarId = (despues ?? otras[0]).id;
  }
  return {
    posicion: indice >= 0 ? indice + 1 : null,
    total: lista.length,
    anteriorId: indice > 0 ? lista[indice - 1].id : null,
    siguienteId: indice >= 0 && indice < lista.length - 1 ? lista[indice + 1].id : null,
    siguienteParaRevisarId,
    restantesParaRevisar: otras.length,
  };
}
