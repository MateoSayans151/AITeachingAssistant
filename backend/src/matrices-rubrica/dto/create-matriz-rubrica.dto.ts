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
import { CANT_NIVELES_MAX, CANT_NIVELES_MIN, MENSAJE_RANGO_NIVELES } from '../../examenes/niveles.util';

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

  // Opcional: qué implica cada nivel de desempeño para este criterio (como en los criterios de un examen, donde también son
  // opcionales). Ausente o [] = sin niveles detallados y se guarda []; si viene con contenido tienen que ser entre 3 y 7, cada
  // uno válido. La cantidad es independiente de la escala de cualquier examen (la matriz se reutiliza entre exámenes); que estén
  // numerados 1..K sin saltos se valida en MatricesRubricaService.create.
  @ValidateIf(traeNivelesDescripcion)
  @ValidateNested({ each: true })
  @Type(() => NivelDescripcionInputDto)
  @ArrayMinSize(CANT_NIVELES_MIN, { message: `Cada criterio describe ${MENSAJE_RANGO_NIVELES} de desempeño (o ninguno).` })
  @ArrayMaxSize(CANT_NIVELES_MAX, { message: `Cada criterio describe ${MENSAJE_RANGO_NIVELES} de desempeño (o ninguno).` })
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
