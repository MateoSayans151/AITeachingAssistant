// Qué se le cuenta al alumno de su examen y cuándo: funciones puras (sin base de datos) para poder testearlas solas.
// El resultado le llega por mail (no hay pantalla pública con la nota), así que acá se decide DE QUIÉN es el turno
// de recibirlo y se arma el contenido, nunca más que eso: sin clave de respuestas ni criterios internos de la IA.

/** Un email se compara siempre en minúscula y sin espacios: el alumno lo tipea como se le ocurre. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface ExamenParaNotificar {
  feedbackModo: string; // 'manual' | 'inmediato'
  feedbackLiberadoEn: Date | null;
}

/**
 * ¿A este alumno hay que notificarle el resultado? Solo si el docente ya revisó su respuesta Y
 * el examen tiene las notas publicadas (el docente las liberó) o es de feedback inmediato
 * (cada alumno recibe lo suyo apenas se revisa, sin esperar al resto).
 */
export function debeNotificarse(respuesta: { estadoRevision: string }, examen: ExamenParaNotificar): boolean {
  return respuesta.estadoRevision !== 'pendiente' && (examen.feedbackLiberadoEn != null || examen.feedbackModo === 'inmediato');
}

// Los Decimal de Prisma llegan como objetos: se pasan a número, redondeado para no mostrar 4.3999999.
type Numerico = number | string | { toString(): string };
const aNumero = (n: Numerico | null | undefined): number => Math.round(Number(n ?? 0) * 100) / 100;

export interface ResultadoParaAlumno {
  titulo: string;
  notaFinal: number;
  escala: { min: number; max: number };
  feedback: string | null;
  porPregunta: Array<{ enunciado: string; notaFinal: number; puntajeMaximo: number }>;
}

/**
 * Contenido del mail con el resultado. Se arma campo por campo (nunca se copia un objeto entero): lo que no está
 * acá no sale, aunque mañana alguien agregue columnas a la respuesta. `notaFinal` es la que decidió el docente
 * (ya incluye la vara si la aceptó); jamás la sugerida por la IA ni la "con vara" sin revisar.
 */
export function armarResultadoParaAlumno(
  examen: { titulo: string; escalaMin: Numerico; escalaMax: Numerico },
  preguntas: Array<{ id: string; enunciado: string; puntajeMaximo: Numerico }>,
  respuesta: { notaTotalFinal: Numerico | null; feedbackGeneralFinal: string | null; respuestasPorPregunta: unknown },
): ResultadoParaAlumno {
  const items = Array.isArray(respuesta.respuestasPorPregunta) ? (respuesta.respuestasPorPregunta as Array<{ preguntaId?: string; notaFinal?: number | null }>) : [];
  const notaDe = new Map(items.map((r) => [r.preguntaId, r.notaFinal]));
  return {
    titulo: examen.titulo,
    notaFinal: aNumero(respuesta.notaTotalFinal),
    escala: { min: aNumero(examen.escalaMin), max: aNumero(examen.escalaMax) },
    feedback: respuesta.feedbackGeneralFinal ?? null,
    porPregunta: preguntas.map((p) => ({
      enunciado: p.enunciado,
      notaFinal: aNumero(notaDe.get(p.id)),
      puntajeMaximo: aNumero(p.puntajeMaximo),
    })),
  };
}
