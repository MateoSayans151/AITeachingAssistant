import { Type } from 'class-transformer';
import { ArrayMinSize, IsEmail, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export class RespuestaPreguntaInputDto {
  @IsUUID()
  preguntaId: string;

  // Forma libre según el tipo de pregunta: string, número, boolean, array de ids, etc.
  @IsOptional()
  contenido?: unknown;
}

export class RegistrarRespuestaDto {
  @IsEmail()
  alumnoEmail: string;

  @ValidateNested({ each: true })
  @Type(() => RespuestaPreguntaInputDto)
  @ArrayMinSize(1)
  respuestas: RespuestaPreguntaInputDto[];
}
