import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CANTIDAD_PREGUNTAS_MAX, CANTIDAD_PREGUNTAS_MIN, DIFICULTADES_PREGUNTA, DificultadPregunta } from '../ai.types';
import { TIPOS_PREGUNTA } from '../../examenes/dto/create-examen.dto';

export const MAX_LARGO_FOCO = 500;
export const MAX_TEMAS = 10;
export const MAX_EXISTENTES = 40;

export class SugerirPreguntasDto {
  // El material sale de este curso (el controller verifica que sea del docente): nunca se mezcla material de otros cursos.
  @IsUUID()
  cursoId: string;

  // Unidades o títulos del material que el docente tildó, o un tema escrito a mano. Vacío = todo el material del curso.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMAS)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  temas?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TIPOS_PREGUNTA.length)
  @ArrayUnique()
  @IsIn(TIPOS_PREGUNTA, { each: true })
  tipos: string[];

  // Cuántas preguntas proponer (por defecto 3).
  @IsOptional()
  @IsInt()
  @Min(CANTIDAD_PREGUNTAS_MIN)
  @Max(CANTIDAD_PREGUNTAS_MAX)
  cantidad?: number;

  @IsOptional()
  @IsIn(DIFICULTADES_PREGUNTA)
  dificultad?: DificultadPregunta;

  // Indicación libre del docente ("que pida justificar, no repetir definiciones"). Se recorta antes de validar.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_LARGO_FOCO)
  foco?: string;

  // Enunciados de las preguntas que el examen ya tiene, para que la IA no las repita.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EXISTENTES)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  existentes?: string[];
}
