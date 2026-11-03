import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class LiberarFeedbackDto {
  /**
   * A quiénes mandarles el mail con la nota al publicar. Sin este campo, a todos los que ya tienen su respuesta revisada. Lista
   * vacía: se publican las notas sin mandar ningún mail (después se pueden mandar a quienes se elija).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  respuestaIds?: string[];
}
