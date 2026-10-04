import { IsBoolean, IsIn, IsNumber, IsOptional } from 'class-validator';
import { MODOS_VARA, ModoVara } from '../vara.util';

// La regla de una vara. Qué combinaciones valen según el modo (y la escala del examen)
// lo valida vara.util → validarRegla, porque depende del examen.
export class ReglaVaraDto {
  @IsIn(MODOS_VARA)
  modo: ModoVara;

  @IsNumber()
  valor: number;

  @IsOptional()
  @IsNumber()
  umbral?: number;

  @IsOptional()
  @IsNumber()
  tope?: number;

  @IsOptional()
  @IsBoolean()
  permitirBajar?: boolean;
}
