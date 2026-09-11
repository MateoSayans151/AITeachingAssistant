import { Type } from 'class-transformer';
import { ArrayMinSize, IsEmail, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class AlumnoInputDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

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
