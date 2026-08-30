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
