import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class NivelDescripcionInputDto {
  @IsInt()
  @Min(1)
  orden: number;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;
}

export class CriterioMatrizInputDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsNumber()
  @Min(0.01)
  puntajeMaximo: number;

  // Descripción de qué implica cada uno de los 5 niveles de desempeño para este criterio.
  @ValidateNested({ each: true })
  @Type(() => NivelDescripcionInputDto)
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  nivelesDescripcion: NivelDescripcionInputDto[];
}

export class CreateMatrizRubricaDto {
  @IsUUID()
  docenteId: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @ValidateNested({ each: true })
  @Type(() => CriterioMatrizInputDto)
  @ArrayMinSize(1)
  criterios: CriterioMatrizInputDto[];
}
