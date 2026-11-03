import { IsBoolean } from 'class-validator';

export class CerrarExamenDto {
  /** true: lo que los alumnos que están rindiendo tengan escrito se entrega ahora. false: terminan su intento con normalidad. */
  @IsBoolean()
  entregarEnCurso: boolean;
}
