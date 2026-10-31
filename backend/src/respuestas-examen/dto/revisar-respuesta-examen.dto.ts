import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { MAX_DEVOLUCION } from '../revision.util';

export class OverridePreguntaDto {
  @IsUUID()
  preguntaId: string;

  @IsNumber()
  notaFinal: number;

  // La devolución del docente sobre esta pregunta (el comentario que acompaña la nota). Sin este campo no se toca la que había.
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DEVOLUCION)
  feedbackFinal?: string;
}

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
