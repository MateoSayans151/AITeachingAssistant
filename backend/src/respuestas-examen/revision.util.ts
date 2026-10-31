// Qué pasa con cada pregunta cuando el docente revisa una respuesta: la nota final y la devolución (el comentario sobre esa pregunta).
// Funciones puras, sin base de datos, para poder testearlas solas.

/** Tope de la devolución de una pregunta (caracteres): holgado para un comentario, chico para no guardar cualquier cosa. */
export const MAX_DEVOLUCION = 4000;

export interface PreguntaRevisable {
  preguntaId: string;
  notaSugerida: number;
  notaFinal: number | null;
  /** La devolución que dejó el docente sobre esta pregunta. Ausente o null: todavía no tocó nada (se ofrece la de la IA). Texto vacío: la quitó a propósito. */
  feedbackFinal?: string | null;
}

export interface OverrideRevision {
  preguntaId: string;
  notaFinal: number;
  /** undefined: no se toca; texto: la nueva devolución; texto vacío: la quita. */
  feedbackFinal?: string;
}

/** Devolución lista para guardar: sin espacios de más y acotada. Vacía → null. */
export function limpiarDevolucion(texto: string | null | undefined): string | null {
  const limpio = (texto ?? '').replace(/\r\n/g, '\n').trim();
  return limpio === '' ? null : limpio.slice(0, MAX_DEVOLUCION);
}

/**
 * Las preguntas de la respuesta después de la revisión. «aceptada» confirma las notas sugeridas y deja lo demás como estaba.
 * «editada» pisa la nota de las preguntas indicadas y, si vino, su devolución; las que no se mencionan conservan lo que tenían
 * (la nota final anterior o, si no había, la sugerida). No muta lo que recibe.
 */
export function aplicarRevision<T extends PreguntaRevisable>(actuales: T[], estado: 'aceptada' | 'editada', overrides: OverrideRevision[] = []): T[] {
  if (estado === 'aceptada') return actuales.map((r) => ({ ...r, notaFinal: r.notaSugerida }));
  const porId = new Map(overrides.map((o) => [o.preguntaId, o]));
  return actuales.map((r) => {
    const o = porId.get(r.preguntaId);
    const siguiente: T = { ...r, notaFinal: o ? o.notaFinal : (r.notaFinal ?? r.notaSugerida) };
    // Quitada a propósito se guarda como '' (no como null): así la pantalla no le vuelve a ofrecer la de la IA como si nunca la hubiera tocado.
    if (o && o.feedbackFinal !== undefined) siguiente.feedbackFinal = limpiarDevolucion(o.feedbackFinal) ?? '';
    return siguiente;
  });
}
