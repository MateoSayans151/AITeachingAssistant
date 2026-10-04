// Corrección en código (sin IA) de las preguntas auto-corregibles: opción múltiple,
// casillas, verdadero/falso, numérica y relacionar pares. Todo o nada por pregunta
// (no hay puntaje parcial) — es la simplificación estándar para este tipo de preguntas.

type Opcion = { id: string; texto: string; correcta: boolean };

function arraysIgualesComoSets(a: unknown, b: string[]): boolean {
  if (!Array.isArray(a)) return false;
  const setA = new Set(a.map(String));
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((x) => setB.has(x));
}

export function corregirPreguntaCerrada(
  tipo: string,
  opciones: unknown,
  contenidoRespuesta: unknown,
): { notaSugerida: number; correcta: boolean } {
  switch (tipo) {
    case 'opcion_multiple': {
      const lista = (opciones as Opcion[]) ?? [];
      const correctaEsperada = lista.find((o) => o.correcta)?.id;
      return { correcta: contenidoRespuesta === correctaEsperada, notaSugerida: 0 };
    }
    case 'casillas': {
      const lista = (opciones as Opcion[]) ?? [];
      const correctasEsperadas = lista.filter((o) => o.correcta).map((o) => o.id);
      return { correcta: arraysIgualesComoSets(contenidoRespuesta, correctasEsperadas), notaSugerida: 0 };
    }
    case 'verdadero_falso': {
      const esperado = (opciones as { correcta: boolean })?.correcta;
      return { correcta: contenidoRespuesta === esperado, notaSugerida: 0 };
    }
    case 'numerica': {
      const cfg = opciones as { respuestaCorrecta: number; tolerancia?: number };
      const valor = Number(contenidoRespuesta);
      const tolerancia = cfg?.tolerancia ?? 0;
      const correcta = Number.isFinite(valor) && Math.abs(valor - cfg?.respuestaCorrecta) <= tolerancia;
      return { correcta, notaSugerida: 0 };
    }
    case 'relacionar_pares': {
      const cfg = opciones as { paresCorrectos: [string, string][] };
      const respuesta = (contenidoRespuesta as [string, string][]) ?? [];
      const esperados = new Set((cfg?.paresCorrectos ?? []).map(([a, b]) => `${a}::${b}`));
      const dados = new Set(respuesta.map(([a, b]) => `${a}::${b}`));
      const correcta = esperados.size === dados.size && [...esperados].every((p) => dados.has(p));
      return { correcta, notaSugerida: 0 };
    }
    default:
      return { correcta: false, notaSugerida: 0 };
  }
}

/** Hash de 32 bits (FNV-1a) para derivar una semilla numérica de un texto. */
function hash32(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Generador pseudoaleatorio determinístico (mulberry32): la misma semilla da siempre la misma secuencia. */
function generador(semilla: number): () => number {
  let a = semilla | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mezcla (Fisher-Yates) una copia de la lista de forma DETERMINÍSTICA a partir de un texto-semilla: el mismo texto da siempre
 * el mismo orden (el alumno ve lo mismo si recarga la página o retoma el intento), pero el orden no guarda relación con el
 * que cargó el docente. No es azar criptográfico ni hace falta: lo único que tiene que lograr es que la posición no delate nada.
 * La misma regla está copiada en `frontend/lib/vista-previa.ts` (un test compara las dos).
 */
export function mezclarDeterministico<T>(items: readonly T[], semilla: string): T[] {
  const copia = [...items];
  const azar = generador(hash32(semilla));
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Quita del `opciones` cualquier campo que revele la clave correcta, para exponerlo al alumno.
 *
 * En "relacionar pares" el docente carga `derecha[i]` como la pareja de `izquierda[i]`: entregarla en ese orden le regalaba la
 * respuesta a cualquiera que mirara las posiciones. Por eso la columna derecha sale MEZCLADA (con una semilla estable: la pregunta
 * y su contenido). La corrección compara por texto (`paresCorrectos`), así que el orden en que se muestra no la afecta.
 * `semilla` es opcional (el id de la pregunta en el flujo real); sin ella la mezcla depende solo del contenido.
 */
export function sanitizarOpcionesParaAlumno(tipo: string, opciones: unknown, semilla?: string): unknown {
  switch (tipo) {
    case 'opcion_multiple':
    case 'casillas': {
      const lista = (opciones as Opcion[]) ?? [];
      return lista.map((o) => ({ id: o.id, texto: o.texto }));
    }
    case 'verdadero_falso':
      return null;
    case 'numerica':
      return null;
    case 'relacionar_pares': {
      const cfg = opciones as { izquierda: unknown[]; derecha: unknown[] };
      const izquierda = cfg?.izquierda ?? [];
      const derecha = cfg?.derecha ?? [];
      const clave = `${semilla ?? ''}|${izquierda.map(String).join('\u0001')}|${derecha.map(String).join('\u0001')}`;
      return { izquierda, derecha: mezclarDeterministico(derecha, clave) };
    }
    default:
      return opciones ?? null;
  }
}
