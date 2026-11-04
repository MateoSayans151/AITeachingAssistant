// Lógica del menú desplegable propio (app/components/Desplegable.tsx): moverse por las opciones con el teclado. Funciones puras, sin React,
// para testearlas solas (backend/test/selectores.test.ts).

export interface OpcionDesplegable {
  valor: string;
  etiqueta: string;
  deshabilitada?: boolean;
  /** Título del grupo al que pertenece (las opciones de un mismo grupo van seguidas; se muestra un encabezado donde cambia). */
  grupo?: string;
}

/** El índice de la próxima opción habilitada yendo en `paso` (1 abajo, -1 arriba) desde `desde`; no da la vuelta (se queda donde está en el borde). -1 si no hay ninguna. */
export function moverIndice(opciones: OpcionDesplegable[], desde: number, paso: 1 | -1): number {
  let i = desde + paso;
  while (i >= 0 && i < opciones.length) {
    if (!opciones[i].deshabilitada) return i;
    i += paso;
  }
  const sigueValida = desde >= 0 && desde < opciones.length && !opciones[desde].deshabilitada;
  return sigueValida ? desde : primerHabilitado(opciones, paso === 1 ? 'fin' : 'inicio');
}

/** Primera o última opción habilitada (Inicio / Fin). -1 si todas están deshabilitadas. */
export function primerHabilitado(opciones: OpcionDesplegable[], donde: 'inicio' | 'fin'): number {
  const indices = opciones.map((_, i) => i).filter((i) => !opciones[i].deshabilitada);
  if (indices.length === 0) return -1;
  return donde === 'inicio' ? indices[0] : indices[indices.length - 1];
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Escribir una letra salta a la próxima opción que empieza con ella; varias seguidas, a la que empieza con todas. Una sola letra (o la misma repetida)
 * busca a partir de la opción siguiente a la actual, así repetirla recorre las que comparten inicio. -1 si ninguna coincide.
 */
export function buscarPorTexto(opciones: OpcionDesplegable[], escrito: string, actual: number): number {
  const q = sinAcentos(escrito);
  const n = opciones.length;
  if (!q || n === 0) return -1;
  const repetida = q.length > 1 && [...q].every((c) => c === q[0]);
  const texto = repetida ? q[0] : q;
  const desde = texto.length === 1 ? 1 : 0;
  for (let paso = desde; paso < desde + n; paso++) {
    const i = (((actual + paso) % n) + n) % n;
    if (!opciones[i].deshabilitada && sinAcentos(opciones[i].etiqueta).startsWith(texto)) return i;
  }
  return -1;
}

/** El índice de la opción con ese valor (o -1). */
export function indiceDe(opciones: OpcionDesplegable[], valor: string): number {
  return opciones.findIndex((o) => o.valor === valor);
}
