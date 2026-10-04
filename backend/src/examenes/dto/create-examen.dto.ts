import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NivelDescripcionInputDto } from '../../matrices-rubrica/dto/create-matriz-rubrica.dto';
import { CANT_NIVELES_MAX, CANT_NIVELES_MIN, MENSAJE_RANGO_NIVELES } from '../niveles.util';

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
  @Max(100)
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

  // Opcional: qué implica cada nivel de la escala del examen en este criterio. Sin esto, la IA juzga con la
  // descripción del criterio y la escala general del examen (como en los trabajos prácticos). Ausente o [] = sin niveles
  // detallados; si trae contenido tienen que ser TODOS los niveles de la escala (la cantidad depende de `niveles` del examen,
  // así que se valida en ExamenesService.create y no acá).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NivelDescripcionInputDto)
  nivelesDescripcion?: NivelDescripcionInputDto[];
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

export class AntiCheatInputDto {
  @IsBoolean()
  pantallaCompleta: boolean;

  @IsBoolean()
  cambioPestana: boolean;

  @IsBoolean()
  pegado: boolean;
}

export class DistribucionEsperadaInputDto {
  @IsNumber()
  umbralAprobacion: number;

  // % de alumnos que se espera que aprueben.
  @IsNumber()
  @Min(0)
  @Max(100)
  aprobadosEsperadosPct: number;
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

  // Escala de niveles de desempeño (entre 3 y 7; 5 por defecto en el wizard), cada uno con su % de equivalencia sobre el
  // puntaje del criterio. El detalle (orden 1..N, último = 100 %, porcentajes crecientes) se valida en ExamenesService.create.
  @ValidateNested({ each: true })
  @Type(() => NivelEscalaInputDto)
  @ArrayMinSize(CANT_NIVELES_MIN, { message: `La escala de niveles tiene que tener ${MENSAJE_RANGO_NIVELES}.` })
  @ArrayMaxSize(CANT_NIVELES_MAX, { message: `La escala de niveles tiene que tener ${MENSAJE_RANGO_NIVELES}.` })
  niveles: NivelEscalaInputDto[];

  @IsIn(['inmediato', 'manual'])
  feedbackModo: 'inmediato' | 'manual';

  // Controles de integridad nivel 1. Si se omite (o todo en false) el examen se rinde sin monitoreo.
  @IsOptional()
  @ValidateNested()
  @Type(() => AntiCheatInputDto)
  antiCheat?: AntiCheatInputDto;

  // Lo que el docente espera del examen; precarga la regla de la vara. Opcional.
  @IsOptional()
  @ValidateNested()
  @Type(() => DistribucionEsperadaInputDto)
  distribucionEsperada?: DistribucionEsperadaInputDto;

  @ValidateNested({ each: true })
  @Type(() => PreguntaInputDto)
  @ArrayMinSize(1)
  preguntas: PreguntaInputDto[];
}
