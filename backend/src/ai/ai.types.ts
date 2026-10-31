import { z } from 'zod';

// ---- Corrección de exámenes (Cátedra): preguntas tipadas con matriz de niveles ----

export interface NivelEscalaInput {
  orden: number;
  nombre: string;
  porcentaje: number; // % del puntajeMaximo del criterio que corresponde a este nivel
}

export interface CriterioPreguntaInput {
  id: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: number;
  // Vacío si el docente no detalló los niveles de este criterio.
  nivelesDescripcion: Array<{ orden: number; nombre: string; descripcion: string }>;
}

export interface PreguntaAbiertaInput {
  id: string;
  /** Posición de la pregunta en el examen (base 1), la misma que ve el alumno: así el feedback dice "pregunta 5" y no "la segunda abierta". */
  numero?: number;
  enunciado: string;
  criterios: CriterioPreguntaInput[];
}

// Material de cátedra (texto plano) que el docente carga por curso, opcional, para que
// la IA lo use como referencia extra al corregir preguntas abiertas de ese curso.
export interface MaterialCursoInput {
  titulo: string;
  unidad: string | null;
  contenido: string;
}

// Schema de salida para la corrección de las preguntas ABIERTAS de una respuesta de examen.
// Las preguntas auto-corregibles (opción múltiple, V/F, numérica, etc.) nunca pasan por acá:
// se corrigen en código comparando contra la clave guardada en Pregunta.opciones.
export const CorreccionExamenSchema = z.object({
  porPregunta: z
    .array(
      z.object({
        preguntaId: z.string().describe('id de la pregunta evaluada'),
        notaPorCriterio: z.array(
          z.object({
            criterioId: z.string(),
            nombre: z.string(),
            nivelSugerido: z
              .number()
              .describe('nivel de desempeño alcanzado: un entero positivo (el orden del nivel de la escala del prompt), según las descripciones de cada nivel'),
            comentario: z.string().describe('comentario breve y específico sobre por qué se asignó ese nivel'),
          }),
        ),
      }),
    )
    .describe('Una entrada por cada pregunta abierta recibida, en el mismo orden'),
  feedbackGeneralSugerido: z
    .string()
    .describe('devolución personalizada para el alumno sobre el examen completo, tono constructivo'),
});

export type CorreccionExamenIA = z.infer<typeof CorreccionExamenSchema>;

// Resultado ya validado/clampeado en código (ver AiService.validarCorreccionExamen):
// agrega notaSugerida numérica por criterio y por pregunta, calculada a partir del
// porcentaje del nivel elegido — nunca se confía en que el modelo haga esa cuenta.
export interface CorreccionExamenResultado {
  porPregunta: Array<{
    preguntaId: string;
    notaSugerida: number;
    notaPorCriterio: Array<{
      criterioId: string;
      nombre: string;
      nivelSugerido: number;
      notaSugerida: number;
      comentario: string;
    }>;
  }>;
  notaTotalSugerida: number;
  feedbackGeneralSugerido: string;
}

// ---- Sugerencia de criterios de rúbrica (borrador para el docente) ----

// Tipos de pregunta que se corrigen con rúbrica (los demás se autocorrigen en código).
export const TIPOS_PREGUNTA_ABIERTA = [
  'desarrollo',
  'resolucion_problema',
  'demostracion',
  'analisis_caso',
  'respuesta_corta',
] as const;
export type TipoPreguntaAbierta = (typeof TIPOS_PREGUNTA_ABIERTA)[number];

export const CANTIDAD_CRITERIOS_MIN = 2;
export const CANTIDAD_CRITERIOS_MAX = 5;
export const CANTIDAD_CRITERIOS_DEFECTO = 3;

/** Una respuesta corta (una o dos oraciones) no da para tres criterios: se piden dos. */
export const CANTIDAD_CRITERIOS_RESPUESTA_CORTA = 2;

/** Cantidad de criterios que se piden si el cliente no la indica, según el tipo de pregunta. */
export const cantidadCriteriosPorDefecto = (tipo: string): number =>
  tipo === 'respuesta_corta' ? CANTIDAD_CRITERIOS_RESPUESTA_CORTA : CANTIDAD_CRITERIOS_DEFECTO;

// Lo que le pedimos al modelo. Es a propósito laxo (sin min/max de longitudes ni sumas): la forma la
// fuerza generateObject, pero los límites reales los impone `normalizarSugerencia` en código, así un
// criterio mal formado se descarta sin tirar abajo todo el borrador.
export const SugerenciaCriteriosSchema = z.object({
  criterios: z
    .array(
      z.object({
        nombre: z.string().describe('nombre corto del criterio, de 60 caracteres como máximo'),
        descripcion: z.string().describe('qué evalúa el criterio, en una o dos oraciones'),
        peso: z
          .number()
          .describe('importancia relativa del criterio: entero de 1 a 100; los pesos de todos los criterios suman 100'),
        niveles: z
          .array(z.string())
          .describe(
            'descripciones de desempeño para este criterio, ordenadas del nivel 1 (el más bajo) al último (el mejor); la cantidad exacta la indica el prompt',
          ),
      }),
    )
    .describe('Los criterios propuestos para la rúbrica de la pregunta'),
});

export type SugerenciaCriteriosIA = z.infer<typeof SugerenciaCriteriosSchema>;

// Un criterio ya validado y normalizado en código (ver sugerencia-criterios.util.ts).
export interface CriterioSugerido {
  nombre: string;
  descripcion: string;
  /** Entero 1..100; los pesos de todos los criterios de la sugerencia suman exactamente 100. */
  peso: number;
  /** Exactamente `cantidadNiveles` descripciones (3 a 7, 5 por defecto): niveles[0] = nivel 1 (el más bajo) … la última = el mejor. */
  niveles: string[];
}

export interface SugerenciaCriterios {
  criterios: CriterioSugerido[];
}

// ---- Sugerencia de preguntas de examen (borrador para el docente) ----

export const DIFICULTADES_PREGUNTA = ['facil', 'media', 'dificil'] as const;
export type DificultadPregunta = (typeof DIFICULTADES_PREGUNTA)[number];

export const CANTIDAD_PREGUNTAS_MIN = 1;
export const CANTIDAD_PREGUNTAS_MAX = 8;
export const CANTIDAD_PREGUNTAS_DEFECTO = 3;

/** Un fragmento del material de cátedra (o un tema suelto) con el que se arma el pedido: el modelo lo cita por su etiqueta ("F1"). */
export interface FragmentoMaterial {
  etiqueta: string;
  titulo: string;
  unidad: string | null;
  contenido: string;
}

// Lo que le pedimos al modelo. Plano y laxo a propósito (sin uniones ni mínimos): la forma la fuerza generateObject, pero lo que
// vale (una sola correcta, pares completos, puntos, longitudes) lo impone `normalizarPreguntas` en código, así una pregunta mal
// formada se descarta sin tirar abajo todo el pedido. Los campos que no corresponden al tipo van en null.
export const SugerenciaPreguntasSchema = z.object({
  preguntas: z
    .array(
      z.object({
        tipo: z.string().describe('uno de los tipos pedidos, tal cual (por ejemplo "opcion_multiple")'),
        enunciado: z.string().describe('el enunciado completo de la pregunta, claro y sin ambigüedades'),
        opciones: z
          .array(z.object({ texto: z.string(), correcta: z.boolean() }))
          .nullable()
          .describe('solo opcion_multiple (3 a 5, UNA correcta) y casillas (4 a 6, al menos dos correctas y al menos una incorrecta); null en los demás'),
        verdaderoFalso: z.boolean().nullable().describe('solo verdadero_falso: true si la afirmación del enunciado es verdadera; null en los demás'),
        numerica: z
          .object({ respuestaCorrecta: z.number(), tolerancia: z.number() })
          .nullable()
          .describe('solo numerica: el valor correcto y la tolerancia absoluta aceptada (0 si tiene que ser exacto); null en los demás'),
        pares: z
          .array(z.object({ izquierda: z.string(), derecha: z.string() }))
          .nullable()
          .describe('solo relacionar_pares: de 3 a 6 pares correctos; null en los demás'),
        explicacion: z
          .string()
          .describe('por qué la respuesta correcta lo es (o, en las preguntas abiertas, qué debería contener una buena respuesta), en 1 a 3 oraciones'),
        fuente: z.string().nullable().describe('etiqueta del fragmento del material en que se basa la pregunta (por ejemplo "F2"); null si no se basa en ninguno'),
      }),
    )
    .describe('Las preguntas propuestas'),
});

export type SugerenciaPreguntasIA = z.infer<typeof SugerenciaPreguntasSchema>;

/** Una pregunta ya validada y normalizada en código (ver sugerencia-preguntas.util.ts). `opciones` tiene la misma forma que se guarda en el examen. */
export interface PreguntaSugerida {
  tipo: string;
  enunciado: string;
  /** Solo en las cerradas: opción múltiple y casillas -> [{id, texto, correcta}], V/F -> {correcta}, numérica -> {respuestaCorrecta, tolerancia}, pares -> {izquierda, derecha, paresCorrectos}. */
  opciones?: unknown;
  explicacion: string;
  /** De qué parte del material sale; null si el modelo no la citó (o citó una que no existe). */
  fuente: { titulo: string; unidad: string | null } | null;
}

export interface SugerenciaPreguntas {
  preguntas: PreguntaSugerida[];
  /** true si el pedido no tuvo ningún fragmento del material: las preguntas salen solo del tema indicado y conviene revisarlas con más cuidado. */
  sinMaterial: boolean;
}
