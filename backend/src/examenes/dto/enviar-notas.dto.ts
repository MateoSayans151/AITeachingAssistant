import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** A qué alumnos (por su respuesta) mandarles el resultado por mail. Una lista vacía se rechaza: no es «todos». */
export class EnviarNotasDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  respuestaIds: string[];
}
