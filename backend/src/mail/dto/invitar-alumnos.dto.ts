import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class InvitarAlumnosDto {
  /** Solo esta publicación (examen + comisión). Sin él, todas las comisiones donde el examen está publicado. */
  @IsUUID()
  @IsOptional()
  examenComisionId?: string;

  /**
   * Solo a estos alumnos (los que el docente tildó; pueden ser de los que ya recibieron la invitación: se les vuelve a mandar).
   * Sin este campo, a todos. Una lista vacía se rechaza: no es «todos».
   */
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  @IsOptional()
  alumnoIds?: string[];
}
