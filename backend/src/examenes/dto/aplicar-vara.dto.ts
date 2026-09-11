import { IsNumber, Max, Min } from 'class-validator';

export class AplicarVaraDto {
  // % de ajuste sobre la nota sugerida por la IA (puede ser negativo). Ej: 10 = +10%.
  @IsNumber()
  @Min(-100)
  @Max(100)
  varaPorcentaje: number;
}
