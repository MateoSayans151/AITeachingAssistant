import { z } from 'zod';

// Schema de salida para la corrección de UNA entrega.
// El LLM tiene que devolver exactamente esta forma (generateObject la fuerza).
export const CorreccionSchema = z.object({
  notaPorCriterio: z
    .array(
      z.object({
        criterioId: z.string().describe('id del criterio de rúbrica evaluado'),
        nombre: z.string(),
        notaSugerida: z.number().describe('nota para este criterio, entre 0 y el puntaje máximo del criterio'),
        comentario: z.string().describe('comentario breve y específico sobre por qué se asignó esa nota'),
      }),
    )
    .describe('Una entrada por cada criterio de la rúbrica, en el mismo orden recibido'),
  notaTotalSugerida: z.number().describe('suma de notaSugerida de todos los criterios'),
  feedbackSugerido: z
    .string()
    .describe('devolución personalizada para el alumno: qué hizo bien, qué mejorar, tono constructivo'),
});

export type CorreccionIA = z.infer<typeof CorreccionSchema>;

// Schema de salida para el análisis agregado del curso (segundo prompt del flujo).
export const ResumenCursoSchema = z.object({
  patronesDetectados: z
    .array(
      z.object({
        criterioOConcepto: z.string(),
        cantidadAlumnosAfectados: z.number(),
        descripcion: z.string().describe('qué error o dificultad concreta se repite'),
      }),
    )
    .describe('Ordenado de mayor a menor impacto'),
  resumenGeneral: z.string().describe('párrafo de síntesis para que el docente lo lea rápido'),
});

export type ResumenCursoIA = z.infer<typeof ResumenCursoSchema>;

export interface CriterioInput {
  id: string;
  nombre: string;
  descripcion: string;
  puntajeMaximo: number;
}

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
  nivelesDescripcion: Array<{ orden: number; nombre: string; descripcion: string }>;
}

export interface PreguntaAbiertaInput {
  id: string;
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
              .describe('nivel de desempeño alcanzado: un entero entre 1 y 5, según las descripciones de cada nivel'),
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
