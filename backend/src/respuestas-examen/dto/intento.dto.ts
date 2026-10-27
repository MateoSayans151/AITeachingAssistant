import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { normalizarEmail } from '../resultado.util';

export class IniciarIntentoDto {
  // Se normaliza antes de validar: el alumno puede tipearlo con mayúsculas o espacios de más.
  @Transform(({ value }) => (typeof value === 'string' ? normalizarEmail(value) : value))
  @IsEmail()
  alumnoEmail: string;

  // Solo lo pide la pantalla cuando el examen tiene acceso abierto (el docente no cargó a los alumnos antes): es el nombre con
  // el que va a aparecer en la lista de respuestas del docente. En un examen con lista se ignora.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString()
  @MaxLength(120)
  alumnoNombre?: string;

  // Obligatorio (true) si el examen tiene anti-cheat: el alumno vio qué se monitorea y aceptó.
  @IsOptional()
  @IsBoolean()
  consentimiento?: boolean;
}

// { [preguntaId]: contenido } — el contenido tiene forma libre según el tipo de pregunta.
export class GuardarBorradorDto {
  @IsObject()
  respuestas: Record<string, unknown>;
}

export class EntregarDto {
  @IsOptional()
  @IsObject()
  respuestas?: Record<string, unknown>;
}

export class EventoIntegridadDto {
  @IsIn(['salida_pantalla_completa', 'cambio_pestana', 'pegado'])
  tipo: 'salida_pantalla_completa' | 'cambio_pestana' | 'pegado';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detalle?: string;
}
