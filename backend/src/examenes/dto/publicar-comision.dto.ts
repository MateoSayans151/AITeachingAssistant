import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

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
}
