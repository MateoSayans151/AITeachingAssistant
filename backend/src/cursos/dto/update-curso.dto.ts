import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Lo que se puede editar de un curso: su nombre y su materia (mandar la materia vacía la quita). */
export class UpdateCursoDto {
  @Transform(recortar)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre?: string;

  @Transform(recortar)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  materia?: string;
}
