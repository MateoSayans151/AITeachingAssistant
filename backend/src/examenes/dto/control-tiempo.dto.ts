import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Tope de la duración de una sesión (24 h: el mismo que tenía el examen al crearse). */
export const MAX_MINUTOS_SESION = 1440;
/** Tope de lo que se le puede dar de una vez a un alumno. */
export const MAX_MINUTOS_EXTRA = 240;
export const MAX_AVISO = 500;

/** Programar (o quitar, con `cierraEn: null`) el cierre automático del examen. */
export class CierreProgramadoDto {
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  cierraEn: string | null;

  /** Al llegar la hora: true entrega lo que tengan los que siguen rindiendo; false los deja terminar. */
  @IsBoolean()
  entregarEnCurso: boolean;
}

export class DuracionDto {
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value))
  @IsInt()
  @Min(1)
  @Max(MAX_MINUTOS_SESION)
  minutos: number;
}

export class TiempoExtraDto {
  @IsInt()
  @Min(1)
  @Max(MAX_MINUTOS_EXTRA)
  minutos: number;
}

export class AvisoDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_AVISO)
  texto: string;
}
