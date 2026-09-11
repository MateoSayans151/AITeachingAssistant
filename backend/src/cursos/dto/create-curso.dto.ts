import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCursoDto {
  @IsUUID()
  docenteId: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  materia?: string;
}
