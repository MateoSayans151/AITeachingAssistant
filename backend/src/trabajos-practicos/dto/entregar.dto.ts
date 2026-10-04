import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class IniciarEntregaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  alumnoNombre: string;

  @IsEmail()
  @MaxLength(200)
  alumnoEmail: string;

  // Obligatorio (true) con modo seguro: el alumno vio qué se monitorea y aceptó.
  @IsOptional()
  @IsBoolean()
  consentimiento?: boolean;
}

export class GuardarBorradorEntregaDto {
  @IsString()
  texto: string;
}

export class EnviarEntregaDto {
  // Sin texto se entrega lo último autoguardado (p. ej. al vencer el tiempo con el texto nuevo demasiado grande).
  @IsOptional()
  @IsString()
  texto?: string;
}
