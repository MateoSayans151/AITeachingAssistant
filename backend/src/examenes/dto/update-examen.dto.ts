import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Lo que se puede cambiar de un examen con alumnos adentro: el título, la consigna y cuándo se libera el feedback (no cambian
 * ninguna nota dada). Las preguntas y los ajustes se reemplazan con PUT, y solo si nadie empezó.
 */
export class UpdateExamenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  consigna?: string;

  @IsOptional()
  @IsIn(['inmediato', 'manual'])
  feedbackModo?: 'inmediato' | 'manual';
}
