// Reglas de la cantidad de niveles de desempeño. Funciones puras y sin dependencias (las importan los DTOs, los servicios y la IA),
// para poder testearlas solas y para que ningún lugar vuelva a asumir una cantidad fija.
//
// La escala de un examen (`Examen.niveles`) tiene entre CANT_NIVELES_MIN y CANT_NIVELES_MAX niveles (5 por defecto). Los criterios de
// una pregunta describen todos esos niveles o ninguno; las matrices de rúbrica, que se reutilizan entre exámenes, tienen una
// cantidad propia (entre el mismo mínimo y máximo) porque no saben a qué escala van a parar.

export const CANT_NIVELES_MIN = 3;
export const CANT_NIVELES_MAX = 7;
export const CANT_NIVELES_DEFECTO = 5;

/** true si es un entero entre CANT_NIVELES_MIN y CANT_NIVELES_MAX. */
export const esCantidadNivelesValida = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= CANT_NIVELES_MIN && n <= CANT_NIVELES_MAX;

/** Lo que se le pide a la IA: un valor inválido (no numérico, fuera de rango) se acota; sin valor, 5. */
export function acotarCantidadNiveles(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return CANT_NIVELES_DEFECTO;
  return Math.min(Math.max(Math.floor(n), CANT_NIVELES_MIN), CANT_NIVELES_MAX);
}

export const MENSAJE_RANGO_NIVELES = `entre ${CANT_NIVELES_MIN} y ${CANT_NIVELES_MAX} niveles`;

/** true si los `orden` son exactamente 1..N (N = cantidad de elementos), sin saltos ni repetidos, vengan en el orden que vengan. */
export function ordenesConsecutivos(items: Array<{ orden: number }>): boolean {
  return items
    .map((i) => i.orden)
    .sort((a, b) => a - b)
    .every((orden, i) => orden === i + 1);
}

export interface NivelDescripcionValidable {
  orden: number;
  nombre?: string;
  descripcion?: string;
}

const textoLleno = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
const cuantos = (n: number) => `${n} ${n === 1 ? 'nivel' : 'niveles'}`;
const etiquetaCriterio = (nombre: unknown) => (typeof nombre === 'string' && nombre.trim() ? nombre.trim() : 'sin nombre');

/** Las descripciones de un criterio, ya con la cantidad aceptada: numeradas 1..K sin saltos y con nombre y descripción llenos. */
function validarDescripciones(etiqueta: string, niveles: NivelDescripcionValidable[]): string | null {
  if (niveles.some((n) => typeof n !== 'object' || n === null)) {
    return `Los niveles del criterio «${etiqueta}» no tienen el formato esperado (orden, nombre y descripción).`;
  }
  if (!ordenesConsecutivos(niveles)) {
    return `Los niveles del criterio «${etiqueta}» tienen que estar numerados del 1 al ${niveles.length}, sin saltos ni repetidos.`;
  }
  const incompleto = niveles.find((n) => !textoLleno(n.nombre) || !textoLleno(n.descripcion));
  if (incompleto) {
    return `Todos los niveles del criterio «${etiqueta}» necesitan nombre y descripción: el nivel ${incompleto.orden} está incompleto.`;
  }
  return null;
}

/**
 * Criterio de una pregunta de un examen: `nivelesDescripcion` ausente o [] (sin niveles detallados) o EXACTAMENTE una descripción
 * por cada nivel de la escala de ESE examen. No se puede expresar con decorators porque depende de otro campo (`Examen.niveles`).
 * Devuelve el mensaje del problema (en castellano, para el docente) o null si está bien.
 */
export function validarNivelesDescripcionCriterio(
  nombreCriterio: unknown,
  niveles: NivelDescripcionValidable[] | null | undefined,
  cantidadNivelesEscala: number,
): string | null {
  if (niveles == null) return null;
  const etiqueta = etiquetaCriterio(nombreCriterio);
  if (!Array.isArray(niveles)) return `Los niveles del criterio «${etiqueta}» tienen que ser una lista.`;
  if (niveles.length === 0) return null;
  if (niveles.length !== cantidadNivelesEscala) {
    return `El criterio «${etiqueta}» describe ${cuantos(niveles.length)} pero la escala del examen tiene ${cantidadNivelesEscala}: describí todos o ninguno.`;
  }
  return validarDescripciones(etiqueta, niveles);
}

/**
 * Criterio de una matriz de rúbrica (reutilizable entre exámenes, su cantidad es independiente de la escala de cualquiera):
 * `nivelesDescripcion` ausente o [] o entre CANT_NIVELES_MIN y CANT_NIVELES_MAX descripciones válidas, numeradas 1..K.
 */
export function validarNivelesDescripcionMatriz(
  nombreCriterio: unknown,
  niveles: NivelDescripcionValidable[] | null | undefined,
): string | null {
  if (niveles == null) return null;
  const etiqueta = etiquetaCriterio(nombreCriterio);
  if (!Array.isArray(niveles)) return `Los niveles del criterio «${etiqueta}» tienen que ser una lista.`;
  if (niveles.length === 0) return null;
  if (niveles.length < CANT_NIVELES_MIN || niveles.length > CANT_NIVELES_MAX) {
    return `El criterio «${etiqueta}» describe ${cuantos(niveles.length)}: tienen que ser ${MENSAJE_RANGO_NIVELES} (o ninguno).`;
  }
  return validarDescripciones(etiqueta, niveles);
}
