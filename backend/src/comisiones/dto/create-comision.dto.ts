import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsEmail, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class AlumnoInputDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // El alumno rinde con su email y el match no distingue mayúsculas: se guarda siempre normalizado (sin espacios, en minúsculas).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;
}

export class CreateComisionDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // El roster se puede cargar junto con la comisión, o alumno por alumno después.
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AlumnoInputDto)
  @ArrayMinSize(1)
  alumnos?: AlumnoInputDto[];
}
