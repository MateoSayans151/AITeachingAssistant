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

/** Quita del `opciones` cualquier campo que revele la clave correcta, para exponerlo al alumno. */
export function sanitizarOpcionesParaAlumno(tipo: string, opciones: unknown): unknown {
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
      return { izquierda: cfg?.izquierda ?? [], derecha: cfg?.derecha ?? [] };
    }
    default:
      return opciones ?? null;
  }
}
