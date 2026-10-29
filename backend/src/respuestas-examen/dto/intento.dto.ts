import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { EVENTOS_DEL_CLIENTE, EventoDelCliente } from '../anticheat.util';
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

  // Código de 6 dígitos que llegó al mail. Obligatorio si la publicación pide verificar el mail.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos' })
  codigo?: string;
}

export class SolicitarCodigoDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizarEmail(value) : value))
  @IsEmail()
  alumnoEmail: string;
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
  @IsIn([...EVENTOS_DEL_CLIENTE])
  tipo: EventoDelCliente;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detalle?: string;
}

// Latido del cliente cada pocos segundos: el servidor lo usa para detectar huecos y para pedir las capturas.
export class LatidoDto {
  @IsBoolean()
  foco: boolean;

  @IsBoolean()
  visible: boolean;

  // true: el navegador sigue compartiendo la pantalla.
  @IsOptional()
  @IsBoolean()
  compartiendo?: boolean;
}

export const MOTIVOS_CAPTURA = ['muestreo', 'cambio_pestana', 'salida_pantalla_completa', 'pantalla_compartida_detenida'] as const;
export type MotivoCaptura = (typeof MOTIVOS_CAPTURA)[number];

export class CapturaDto {
  @IsIn([...MOTIVOS_CAPTURA])
  motivo: MotivoCaptura;

  // Id del pedido del servidor (solo en las de muestreo).
  @IsOptional()
  @IsUUID()
  pedidoId?: string;

  // La marca visible que mostraba la página al capturar.
  @IsOptional()
  @IsString()
  @MaxLength(16)
  marca?: string;

  // data:image/jpeg;base64,...  (el tope real se valida en IntegridadService; este es el del cuerpo)
  @IsString()
  @MaxLength(450_000)
  imagen: string;
}
