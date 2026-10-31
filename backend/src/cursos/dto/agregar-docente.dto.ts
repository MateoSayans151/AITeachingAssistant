import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

export class AgregarDocenteDto {
  // Se recorta y pasa a minúsculas antes de validar: "  Ana@UADE.edu.ar " es el mismo email que "ana@uade.edu.ar".
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(200)
  email: string;
}
