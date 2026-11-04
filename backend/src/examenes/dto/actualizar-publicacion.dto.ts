import { IsDateString, IsOptional, ValidateIf } from 'class-validator';

// Fechas de una publicación (el link a una comisión). `null` quita la fecha; si no viene, no se toca.
export class ActualizarPublicacionDto {
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  @IsOptional()
  fechaInicio?: string | null;

  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  @IsOptional()
  fechaFin?: string | null;
}
