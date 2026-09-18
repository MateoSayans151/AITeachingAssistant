import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMaterialCursoDto {
  @IsString()
  @IsNotEmpty()
  titulo: string;

  // Libre: "U3 Espacios vectoriales", "Bibliografía obligatoria", etc. Solo para ordenar
  // la lista en pantalla — no se valida contra un temario estructurado.
  @IsOptional()
  @IsString()
  unidad?: string;

  // Mismo tope que MAX_TEXTO_NO_CONFIABLE en AiService: evita que un apunte gigante
  // dispare el costo por token de cada corrección que lo use como contexto.
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  contenido: string;
}
