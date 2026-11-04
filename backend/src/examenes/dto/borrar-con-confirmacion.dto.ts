import { IsString, MaxLength } from 'class-validator';

/** Borrar un examen o un curso exige escribir su nombre: protege de un clic sin querer. */
export class BorrarConConfirmacionDto {
  @IsString()
  @MaxLength(300)
  confirmacion: string;
}
