import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

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
  @IsUUID()
  docenteId: string;

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
}
