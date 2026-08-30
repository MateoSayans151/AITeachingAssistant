import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEntregaDto {
  @IsUUID()
  trabajoPracticoId: string;

  @IsString()
  @IsNotEmpty()
  alumnoNombre: string;

  @IsEmail()
  @IsOptional()
  alumnoEmail?: string;

  @IsString()
  @IsNotEmpty()
  textoTrabajo: string;
}
