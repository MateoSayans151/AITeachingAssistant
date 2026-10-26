import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_CONTENIDO_MATERIAL } from '../extractor-texto.util';

export class CreateMaterialCursoDto {
  @IsString()
  @IsNotEmpty()
  titulo: string;

  // Libre: "U3 Espacios vectoriales", "Bibliografía obligatoria", etc. Solo para ordenar
  // la lista en pantalla — no se valida contra un temario estructurado.
  @IsOptional()
  @IsString()
  unidad?: string;

  // Tope del texto de un material. A la IA solo llegan los fragmentos recuperados por el RAG
  // (cada uno acotado en AiService), así que un material largo no encarece cada corrección.
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENIDO_MATERIAL)
  contenido: string;
}
