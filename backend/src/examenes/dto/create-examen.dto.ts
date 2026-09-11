import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { NivelDescripcionInputDto } from '../../matrices-rubrica/dto/create-matriz-rubrica.dto';

// Mismos valores que el enum TipoPregunta en schema.prisma.
export const TIPOS_PREGUNTA = [
  'desarrollo',
  'resolucion_problema',
  'demostracion',
  'analisis_caso',
  'respuesta_corta',
  'numerica',
  'relacionar_pares',
  'opcion_multiple',
  'casillas',
  'verdadero_falso',
] as const;

// Tipos que se corrigen en código comparando contra una clave, nunca con IA.
export const TIPOS_AUTOCORREGIBLES = ['numerica', 'relacionar_pares', 'opcion_multiple', 'casillas', 'verdadero_falso'];

export class NivelEscalaInputDto {
  @IsInt()
  @Min(1)
  orden: number;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  colorHex: string;

  @IsNumber()
  @Min(0)
  porcentaje: number;
}

export class CriterioPreguntaInputDto {
  @IsUUID()
  @IsOptional()
  matrizOrigenId?: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsNumber()
  @Min(0.01)
  puntajeMaximo: number;

  @ValidateNested({ each: true })
  @Type(() => NivelDescripcionInputDto)
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  nivelesDescripcion: NivelDescripcionInputDto[];
}

export class PreguntaInputDto {
  @IsIn(TIPOS_PREGUNTA)
  tipo: (typeof TIPOS_PREGUNTA)[number];

  @IsString()
  @IsNotEmpty()
  enunciado: string;

  @IsNumber()
  @Min(0.01)
  puntajeMaximo: number;

  // Preguntas abiertas: criterios con matriz de niveles (obligatorio para esos tipos,
  // se valida en el service porque depende del tipo). Preguntas cerradas: opciones/clave.
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CriterioPreguntaInputDto)
  criterios?: CriterioPreguntaInputDto[];

  // Forma libre según el tipo (array de choices con `correcta`, objeto con respuesta
  // numérica + tolerancia, pares, etc.) — sin @IsObject() porque para varios tipos
  // (opción múltiple, casillas) es un array, y class-validator no considera "objeto" a un array.
  @IsOptional()
  opciones?: Record<string, unknown> | unknown[];
}

export class CreateExamenDto {
  @IsUUID()
  cursoId: string;

  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsNotEmpty()
  consigna: string;

  @IsIn(['sesion_tiempo', 'ventana_dias'])
  modalidad: 'sesion_tiempo' | 'ventana_dias';

  @IsOptional()
  @IsInt()
  @Min(1)
  duracionMinutos?: number;

  @IsNumber()
  escalaMin: number;

  @IsNumber()
  escalaMax: number;

  // Escala de 5 niveles de desempeño, cada uno con su % de equivalencia sobre el puntaje del criterio.
  @ValidateNested({ each: true })
  @Type(() => NivelEscalaInputDto)
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  niveles: NivelEscalaInputDto[];

  @IsIn(['inmediato', 'manual'])
  feedbackModo: 'inmediato' | 'manual';

  @ValidateNested({ each: true })
  @Type(() => PreguntaInputDto)
  @ArrayMinSize(1)
  preguntas: PreguntaInputDto[];
}
