import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class PublicarComisionDto {
  @IsUUID()
  comisionId: string;

  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;

  // true (por defecto): cualquier alumno con el link puede entrar, aunque el docente no lo haya cargado antes; false: solo los de la lista.
  @IsBoolean()
  @IsOptional()
  accesoAbierto?: boolean;

  // true: el alumno tiene que escribir un código de 6 dígitos que le llega al mail. Por defecto false (los links ya publicados siguen igual).
  @IsBoolean()
  @IsOptional()
  verificarEmail?: boolean;

  // Dominio al que tienen que pertenecer los mails que entran (p. ej. "alumnos.edu.ar"). Vacío = cualquiera.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/^@+/, '') : value))
  @IsString()
  @MaxLength(100)
  @Matches(/^([a-z0-9-]+\.)+[a-z]{2,}$|^$/, { message: 'El dominio no es válido (ejemplo: alumnos.edu.ar)' })
  dominioPermitido?: string;
}
