import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import {
  CorreccionSchema,
  ResumenCursoSchema,
  CorreccionIA,
  ResumenCursoIA,
  CriterioInput,
} from './ai.types';

/**
 * Capa de acceso al LLM. Todo el "cerebro" del producto vive acá adentro:
 * el resto de la app nunca llama a un provider de IA directamente.
 *
 * Por qué Gemini 3.1 Flash-Lite por default:
 * comparado con GPT-5 nano en benchmarks generales (MMLU Pro, GPQA) rinde
 * notablemente mejor en comprensión/instrucciones — justo lo que pesa acá
 * (seguir una rúbrica con matices), aunque cueste algo más por token.
 * Claude Haiku 4.5 queda como alternativa a un cambio de env var, sin tocar código.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: string;
  private readonly modelId: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>('AI_PROVIDER', 'google');
    this.modelId =
      this.provider === 'anthropic'
        ? this.config.get<string>('ANTHROPIC_MODEL_ID', 'claude-haiku-4-5')
        : this.config.get<string>('GOOGLE_MODEL_ID', 'gemini-3.1-flash-lite');
  }

  /** Nombre del modelo activo, para guardarlo junto a cada corrección (trazabilidad). */
  get modeloActivo(): string {
    return `${this.provider}:${this.modelId}`;
  }

  private getModel() {
    if (this.provider === 'anthropic') {
      return anthropic(this.modelId);
    }
    return google(this.modelId);
  }

  /**
   * Prompt 1 del flujo (paso 3 de la arquitectura MVP):
   * consigna + rúbrica + trabajo del alumno -> nota sugerida por criterio + feedback.
   */
  async corregirEntrega(params: {
    consigna: string;
    criterios: CriterioInput[];
    textoTrabajo: string;
  }): Promise<CorreccionIA> {
    const { consigna, criterios, textoTrabajo } = params;

    const rubricaTexto = criterios
      .map((c) => `- [${c.id}] ${c.nombre} (máx ${c.puntajeMaximo} pts): ${c.descripcion}`)
      .join('\n');

    const prompt = `Sos un asistente que ayuda a un docente a corregir trabajos escritos.
Vas a recibir la CONSIGNA del trabajo práctico, la RÚBRICA (una lista de criterios con su puntaje máximo)
y el TRABAJO de un alumno. Tu tarea es evaluar el trabajo contra cada criterio de la rúbrica exclusivamente.

Reglas importantes:
- No inventes criterios que no estén en la rúbrica.
- notaSugerida de cada criterio nunca puede superar su puntaje máximo.
- El feedback va dirigido al alumno: concreto, constructivo, sin exponer al docente ni a otros alumnos.
- Si el trabajo no responde a la consigna, decilo explícitamente en el feedback y calificá en consecuencia.

CONSIGNA:
${consigna}

RÚBRICA:
${rubricaTexto}

TRABAJO DEL ALUMNO:
${textoTrabajo}`;

    const { object } = await generateObject({
      model: this.getModel(),
      schema: CorreccionSchema,
      prompt,
    });

    this.logger.debug(`Corrección generada con ${this.modeloActivo}`);
    return object;
  }

  /**
   * Prompt 2 del flujo (paso 5 de la arquitectura MVP):
   * corre una sola vez por trabajo práctico, sobre el agregado de correcciones ya confirmadas,
   * para detectar qué criterios/conceptos generaron más dificultad en el curso.
   */
  async generarResumenCurso(params: {
    consigna: string;
    criterios: CriterioInput[];
    correcciones: Array<{ notaPorCriterio: unknown; feedbackFinal: string | null; feedbackSugerido: string }>;
  }): Promise<ResumenCursoIA> {
    const { consigna, criterios, correcciones } = params;

    const rubricaTexto = criterios.map((c) => `- ${c.nombre} (máx ${c.puntajeMaximo} pts)`).join('\n');
    const correccionesTexto = correcciones
      .map(
        (c, i) =>
          `Entrega ${i + 1}:\nNotas por criterio: ${JSON.stringify(c.notaPorCriterio)}\nFeedback: ${
            c.feedbackFinal ?? c.feedbackSugerido
          }`,
      )
      .join('\n\n');

    const prompt = `Sos un asistente que ayuda a un docente a entender el desempeño general de su curso
en un trabajo práctico ya corregido. Vas a recibir la consigna, la rúbrica, y las correcciones individuales
de todas las entregas. Identificá qué criterios o conceptos generaron más dificultad de forma repetida
entre los alumnos (no listes errores de un solo alumno como si fueran un patrón general).

CONSIGNA:
${consigna}

RÚBRICA:
${rubricaTexto}

CORRECCIONES INDIVIDUALES:
${correccionesTexto}`;

    const { object } = await generateObject({
      model: this.getModel(),
      schema: ResumenCursoSchema,
      prompt,
    });

    return object;
  }
}
