// La devolución de una pregunta que corrige la IA (el comentario que acompaña la nota): qué se le muestra al docente para que la corrija.
// Funciones puras (sin React ni red) para testearlas con node:test (backend/test/devolucion.test.ts).

interface ConComentarios {
  notaPorCriterio?: { nombre: string; comentario: string }[];
  /** Lo que el docente dejó al revisar: ausente o null = todavía no la tocó; '' = la quitó a propósito. */
  feedbackFinal?: string | null;
}

/** El texto de la IA como punto de partida: un renglón por criterio («Claridad: se entiende…»). Vacío si la IA no comentó nada. */
export function devolucionDeLaIA(rp: ConComentarios): string {
  return (rp.notaPorCriterio ?? [])
    .filter((c) => (c.comentario ?? '').trim() !== '')
    .map((c) => `${c.nombre}: ${c.comentario.trim()}`)
    .join('\n');
}

/** Lo que va en el campo al abrir la respuesta: lo que el docente ya había dejado (aunque sea vacío) o, si nunca la tocó, la de la IA. */
export function devolucionInicial(rp: ConComentarios): string {
  return rp.feedbackFinal != null ? rp.feedbackFinal : devolucionDeLaIA(rp);
}
