import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

// Ausente (o null) y [] significan "sin niveles detallados": en esos casos no se valida nada más.
const traeNivelesDescripcion = (c: { nivelesDescripcion?: unknown }) =>
  c.nivelesDescripcion != null && !(Array.isArray(c.nivelesDescripcion) && c.nivelesDescripcion.length === 0);

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

  // Opcional: qué implica cada uno de los 5 niveles de desempeño para este criterio (como en los
  // criterios de un examen, donde también son opcionales). Ausente o [] = sin niveles detallados y se
  // guarda []; si viene con contenido tienen que ser exactamente 5, cada uno válido.
  @ValidateIf(traeNivelesDescripcion)
  @ValidateNested({ each: true })
  @Type(() => NivelDescripcionInputDto)
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  nivelesDescripcion?: NivelDescripcionInputDto[];
}

export class CreateMatrizRubricaDto {
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
