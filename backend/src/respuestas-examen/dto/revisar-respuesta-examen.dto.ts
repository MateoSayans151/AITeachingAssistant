import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class OverridePreguntaDto {
  @IsUUID()
  preguntaId: string;

  @IsNumber()
  notaFinal: number;
}

// Mismo criterio que RevisarCorreccionDto (flujo de TrabajoPractico):
// "aceptada" confirma las notas sugeridas tal cual, "editada" permite pisar puntualmente
// la nota de alguna(s) pregunta(s) y/o el total y el feedback general.
export class RevisarRespuestaExamenDto {
  @IsIn(['aceptada', 'editada'])
  estadoRevision: 'aceptada' | 'editada';

  @IsNumber()
  @IsOptional()
  notaTotalFinal?: number;

  @IsString()
  @IsOptional()
  feedbackGeneralFinal?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OverridePreguntaDto)
  overridesPorPregunta?: OverridePreguntaDto[];
}
