import { IsOptional, IsUUID } from 'class-validator';

export class InvitarAlumnosDto {
  /** Solo esta publicación (examen + comisión). Sin él, todas las comisiones donde el examen está publicado. */
  @IsUUID()
  @IsOptional()
  examenComisionId?: string;
}
