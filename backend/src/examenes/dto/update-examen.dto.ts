import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Lo único que se edita de un examen ya creado: su título (las preguntas y los ajustes no se tocan una vez creado). */
export class UpdateExamenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;
}
