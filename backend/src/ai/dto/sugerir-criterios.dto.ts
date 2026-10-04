import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CANTIDAD_CRITERIOS_MAX,
  CANTIDAD_CRITERIOS_MIN,
  TIPOS_PREGUNTA_ABIERTA,
  TipoPreguntaAbierta,
} from '../ai.types';

export const MAX_LARGO_ENUNCIADO = 5000;

export class SugerirCriteriosDto {
  // Se recorta antes de validar: un enunciado de puros espacios cuenta como vacío.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LARGO_ENUNCIADO)
  enunciado: string;

  // Solo los tipos que se corrigen con rúbrica; los autocorregibles no tienen criterios.
  @IsIn(TIPOS_PREGUNTA_ABIERTA)
  tipo: TipoPreguntaAbierta;

  // Cuántos criterios proponer (por defecto 3).
  @IsOptional()
  @IsInt()
  @Min(CANTIDAD_CRITERIOS_MIN)
  @Max(CANTIDAD_CRITERIOS_MAX)
  cantidad?: number;
}
