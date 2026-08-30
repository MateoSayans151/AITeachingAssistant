import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

// El docente puede:
// - "aceptar": confirma la nota/feedback sugeridos tal cual
// - "editar": pisa notaTotalFinal y/o feedbackFinal con su propia versión
export class RevisarCorreccionDto {
  @IsIn(['aceptada', 'editada'])
  estadoRevision: 'aceptada' | 'editada';

  @IsNumber()
  @IsOptional()
  notaTotalFinal?: number;

  @IsString()
  @IsOptional()
  feedbackFinal?: string;
}
