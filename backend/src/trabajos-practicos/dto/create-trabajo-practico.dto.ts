import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export const MODALIDADES_LINK = ['ventana_tiempo', 'horario_fijo'] as const;
export type ModalidadLink = (typeof MODALIDADES_LINK)[number];

export class CriterioRubricaInputDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsNumber()
  @Min(0.01)
  puntajeMaximo: number;
}

export class CreateTrabajoPracticoDto {
  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsOptional()
  materia?: string;

  @IsString()
  @IsNotEmpty()
  consigna: string;

  // La rúbrica se carga junto con el TP: una lista de criterios con su puntaje máximo.
  @ValidateNested({ each: true })
  @Type(() => CriterioRubricaInputDto)
  @ArrayMinSize(1)
  criterios: CriterioRubricaInputDto[];

  // Link para los alumnos: se genera siempre; esto es lo único que se elige.
  // El detalle entre campos (qué hace falta según la modalidad) lo valida resolverConfigLink.
  @IsBoolean()
  @IsOptional()
  modoSeguro?: boolean;

  @IsIn(MODALIDADES_LINK)
  modalidad: ModalidadLink;

  // ventana_tiempo: minutos que tiene cada alumno desde que empieza.
  @IsInt()
  @IsOptional()
  duracionMinutos?: number;

  // horario_fijo: el link se abre en fechaInicio y vence en fechaFin.
  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;
}
