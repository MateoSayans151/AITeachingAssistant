import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { normalizarEmail } from '../resultado.util';

export class IniciarIntentoDto {
  // Se normaliza antes de validar: el alumno puede tipearlo con mayúsculas o espacios de más.
  @Transform(({ value }) => (typeof value === 'string' ? normalizarEmail(value) : value))
  @IsEmail()
  alumnoEmail: string;

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
