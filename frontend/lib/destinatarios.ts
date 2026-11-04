// La lista para tildar a quiénes se les manda un mail (el link del examen o su nota): funciones puras, sin React, para testearlas solas
// (backend/test/destinatarios.test.ts).

export interface DestinatarioLista {
  /** El id con el que el servidor identifica al destinatario (el alumno o su respuesta). */
  id: string;
  nombre: string;
  email: string;
  /** Una línea extra opcional (la comisión, la nota...). */
  detalle?: string;
  /** Cuándo se le mandó (null o ausente = todavía no) y cuántas veces. */
  enviadoEn?: string | null;
  veces?: number;
  /** El último intento falló (solo si nunca salió). */
  error?: string | null;
  /** Hay un envío en marcha para este alumno. */
  enCamino?: boolean;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Los que coinciden con lo buscado en el nombre o el mail (sin distinguir mayúsculas ni tildes). Sin búsqueda, todos. */
export function filtrarDestinatarios<T extends Pick<DestinatarioLista, 'nombre' | 'email'>>(lista: T[], busqueda: string): T[] {
  const q = sinAcentos(busqueda.trim());
  if (!q) return lista;
  return lista.filter((d) => sinAcentos(d.nombre).includes(q) || sinAcentos(d.email).includes(q));
}

/**
 * Qué viene tildado al abrir: los que todavía no recibieron nada y no tienen un envío en camino. Los que ya lo recibieron quedan sin
 * tildar a propósito: volver a mandarlo es una decisión del docente, no un efecto de «marcar todos» sin mirar.
 */
export function preseleccion(lista: DestinatarioLista[]): Set<string> {
  return new Set(lista.filter((d) => !d.enviadoEn && !d.enCamino).map((d) => d.id));
}

/**
 * «Marcar todos» / «Desmarcar todos» sobre lo que se ve (la búsqueda acota): si todos los visibles están marcados los desmarca; si no, los marca.
 * Lo elegido que no se ve (filtrado por la búsqueda) no se toca.
 */
export function alternarTodos(lista: DestinatarioLista[], elegidos: Set<string>, visibles: DestinatarioLista[]): Set<string> {
  const ids = new Set(lista.map((d) => d.id));
  const siguiente = new Set([...elegidos].filter((id) => ids.has(id)));
  const todosMarcados = visibles.length > 0 && visibles.every((d) => siguiente.has(d.id));
  for (const d of visibles) {
    if (todosMarcados) siguiente.delete(d.id);
    else siguiente.add(d.id);
  }
  return siguiente;
}

/** Cuántos se van a mandar, cuántos son primera vez y cuántos son reenvíos (ya lo habían recibido). */
export function resumenSeleccion(lista: DestinatarioLista[], elegidos: Set<string>): { total: number; nuevos: number; repetidos: number } {
  const marcados = lista.filter((d) => elegidos.has(d.id));
  const repetidos = marcados.filter((d) => !!d.enviadoEn).length;
  return { total: marcados.length, nuevos: marcados.length - repetidos, repetidos };
}
